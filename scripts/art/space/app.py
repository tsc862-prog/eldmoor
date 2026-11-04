# Eldmoor's art generator (#703): a private ZeroGPU Space under the owner's account (tsc862/eldmoor-art).
# SDXL base plus the manifest's pixel-art LoRAs (loras.json, written by `npm run art:space -- --push` from
# scripts/art/manifest.json), two API functions that scripts/art/space.mjs calls through Gradio's HTTP API: `generate` (text to
# image: tiles, props, portraits, backdrops) and `img2img` (#763: buildings, landmarks and sprites start from the game's own
# procedural art at a low strength, so the view, silhouette and palette are the game's and the model adds texture).
# Images draw on the account's daily ZeroGPU quota, never on Inference Providers credits.
#
# ZeroGPU rules followed (https://huggingface.co/docs/hub/spaces-zerogpu, read 2026-11-03): the pipeline is loaded and
# placed on cuda at module level, only the decorated function gets a real GPU, and @spaces.GPU takes a dynamic duration
# sized to the steps and pixels (a shorter reservation queues first and never asks for more quota than it needs).
#
# Image to image follows the diffusers docs (https://huggingface.co/docs/diffusers/using-diffusers/img2img and
# api/pipelines/auto_pipeline, read 2026-11-03; the v0.41.0 source of auto_pipeline.py and
# pipeline_stable_diffusion_xl_img2img.py checked against the pin): AutoPipelineForImage2Image.from_pipe builds
# StableDiffusionXLImg2ImgPipeline on the same modules without reallocating them, so the loaded weights and LoRA adapters are
# shared and set_adapters on either pipeline holds for both. The pipeline takes its size from the image and denoises
# int(steps * strength) steps. The init image arrives as base64 text: over this HTTP API Gradio takes files only as URLs.
import base64
import binascii
import io
import json
import math
import os
import time

import gradio as gr
import spaces
import torch
from diffusers import AutoencoderKL, AutoPipelineForImage2Image, StableDiffusionXLPipeline
from PIL import Image, UnidentifiedImageError

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "loras.json"), encoding="utf-8") as f:
    CFG = json.load(f)

BASE = CFG.get("base", "stabilityai/stable-diffusion-xl-base-1.0")
VAE = CFG.get("vae", "madebyollin/sdxl-vae-fp16-fix")  # the base VAE overflows in fp16; this one does not
LORAS = CFG["loras"]  # [{key, repo, weights}] in the manifest's candidate order

vae = AutoencoderKL.from_pretrained(VAE, torch_dtype=torch.float16)
pipe = StableDiffusionXLPipeline.from_pretrained(BASE, vae=vae, torch_dtype=torch.float16, use_safetensors=True)
for lora in LORAS:
    pipe.load_lora_weights(lora["repo"], weight_name=lora["weights"], adapter_name=lora["key"])
pipe.to("cuda")
pipe_i2i = AutoPipelineForImage2Image.from_pipe(pipe)  # the same modules, no second copy
BY_REPO = {lora["repo"]: lora["key"] for lora in LORAS}

MAX_SIDE = 1024
MAX_STEPS = 50
MAX_INIT_B64 = 4_000_000  # a nearest-neighbour upscale compresses to well under this


def gpu_duration(prompt, negative, seed, steps, guidance, width, height, lora_scale, lora_repo):
    """GPU seconds to reserve: the same rule as spaceDuration in scripts/art/space.mjs."""
    px = (int(width) * int(height)) / (1024 * 1024)
    return int(min(120, math.ceil(10 + int(steps) * 0.6 * px)))


@spaces.GPU(duration=gpu_duration)
def _draw(prompt, negative, seed, steps, guidance, width, height, lora_scale, adapter):
    t0 = time.perf_counter()
    pipe.set_adapters([adapter], adapter_weights=[float(lora_scale)])
    gen = torch.Generator(device="cuda").manual_seed(int(seed))
    image = pipe(
        prompt=prompt,
        negative_prompt=negative or None,
        num_inference_steps=int(steps),
        guidance_scale=float(guidance),
        width=int(width),
        height=int(height),
        generator=gen,
    ).images[0]
    return image, round(time.perf_counter() - t0, 2)


def gpu_duration_i2i(prompt, negative, seed, steps, guidance, init, strength, lora_scale, adapter):
    """GPU seconds to reserve: gpu_duration scaled by strength, as spaceDuration in scripts/art/space.mjs."""
    px = (init.width * init.height) / (1024 * 1024)
    return int(min(120, math.ceil(10 + int(steps) * float(strength) * 0.6 * px)))


@spaces.GPU(duration=gpu_duration_i2i)
def _draw_i2i(prompt, negative, seed, steps, guidance, init, strength, lora_scale, adapter):
    t0 = time.perf_counter()
    pipe_i2i.set_adapters([adapter], adapter_weights=[float(lora_scale)])
    gen = torch.Generator(device="cuda").manual_seed(int(seed))
    image = pipe_i2i(
        prompt=prompt,
        negative_prompt=negative or None,
        image=init,
        strength=float(strength),
        num_inference_steps=int(steps),
        guidance_scale=float(guidance),
        generator=gen,
    ).images[0]
    return image, round(time.perf_counter() - t0, 2)


def adapter_of(lora_repo):
    adapter = BY_REPO.get(str(lora_repo or "").strip())
    if adapter is None:
        raise gr.Error(f"unknown LoRA {lora_repo!r}: not in the Space (loras.json has {', '.join(BY_REPO)})")
    return adapter


def check_common(prompt, steps):
    if not prompt or len(prompt) > 2000:
        raise gr.Error("prompt missing or longer than 2000 characters")
    if not 1 <= steps <= MAX_STEPS:
        raise gr.Error(f"steps {steps}: 1..{MAX_STEPS}")


def check_size(width, height):
    if not (64 <= width <= MAX_SIDE and 64 <= height <= MAX_SIDE) or width % 8 or height % 8:
        raise gr.Error(f"size {width}x{height}: each side 64..{MAX_SIDE}, a multiple of 8")


def generate(prompt, negative, seed, steps, guidance, width, height, lora_scale, lora_repo):
    """One image from text. Returns (PNG, GPU seconds used inside the decorated call)."""
    adapter = adapter_of(lora_repo)
    width, height, steps = int(width), int(height), int(steps)
    check_common(prompt, steps)
    check_size(width, height)
    return _draw(prompt, negative, int(seed), steps, float(guidance), width, height, float(lora_scale), adapter)


def read_init(init_png):
    """The init image from base64 text (a data: prefix is allowed) as RGB; a bad one is the caller's error, not a GPU call."""
    text = str(init_png or "").strip()
    if not text or len(text) > MAX_INIT_B64:
        raise gr.Error("init image missing or too large")
    try:
        image = Image.open(io.BytesIO(base64.b64decode(text.split(",", 1)[-1], validate=True)))
        image.load()
    except (binascii.Error, ValueError, OSError, UnidentifiedImageError) as err:
        raise gr.Error(f"init image is not a PNG in base64: {err}")
    return image.convert("RGB")


def img2img(prompt, negative, seed, steps, guidance, init_png, strength, lora_scale, lora_repo):
    """One image from the game's art at a strength. Returns (PNG, GPU seconds used inside the decorated call)."""
    adapter = adapter_of(lora_repo)
    steps, strength = int(steps), float(strength)
    check_common(prompt, steps)
    if not 0.05 <= strength <= 0.95 or int(steps * strength) < 1:
        raise gr.Error(f"strength {strength} at {steps} steps: .05 to .95, at least one step")
    init = read_init(init_png)
    check_size(init.width, init.height)
    return _draw_i2i(prompt, negative, int(seed), steps, float(guidance), init, strength, float(lora_scale), adapter)


def common_inputs():
    return [
        gr.Textbox(label="prompt"),
        gr.Textbox(label="negative"),
        gr.Number(label="seed", value=1771, precision=0),
        gr.Number(label="steps", value=25, precision=0),
        gr.Number(label="guidance", value=7),
    ]


def lora_inputs():
    return [gr.Number(label="lora_scale", value=0.55), gr.Textbox(label="lora_repo", value=next(iter(BY_REPO)))]


def outputs():
    return [gr.Image(label="image", type="pil", format="png"), gr.Number(label="gpu_s")]


with gr.Blocks(title="Eldmoor art") as demo:
    gr.Markdown("Private generator for Eldmoor's pixel-art assets (SDXL + pixel-art LoRAs on ZeroGPU).")
    with gr.Tab("Text"):
        text_in = common_inputs() + [
            gr.Number(label="width", value=1024, precision=0),
            gr.Number(label="height", value=1024, precision=0),
        ] + lora_inputs()
        text_out = outputs()
        gr.Button("Generate").click(generate, text_in, text_out, api_name="generate")
    with gr.Tab("Image to image"):
        i2i_in = common_inputs() + [
            gr.Textbox(label="init_png (base64)"),
            gr.Number(label="strength", value=0.4),
        ] + lora_inputs()
        i2i_out = outputs()
        gr.Button("Generate").click(img2img, i2i_in, i2i_out, api_name="img2img")

if __name__ == "__main__":
    demo.queue(max_size=16).launch(show_error=True)
