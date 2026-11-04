# Eldmoor's art generator (#703): a private ZeroGPU Space under the owner's account (tsc862/eldmoor-art).
# SDXL base plus the manifest's pixel-art LoRAs (loras.json, written by `npm run art:space -- --push` from
# scripts/art/manifest.json), one API function `generate` that scripts/art/space.mjs calls through Gradio's HTTP API.
# Images draw on the account's daily ZeroGPU quota, never on Inference Providers credits.
#
# ZeroGPU rules followed (https://huggingface.co/docs/hub/spaces-zerogpu, read 2026-11-03): the pipeline is loaded and
# placed on cuda at module level, only the decorated function gets a real GPU, and @spaces.GPU takes a dynamic duration
# sized to the steps and pixels (a shorter reservation queues first and never asks for more quota than it needs).
import json
import math
import os
import time

import gradio as gr
import spaces
import torch
from diffusers import AutoencoderKL, StableDiffusionXLPipeline

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
BY_REPO = {lora["repo"]: lora["key"] for lora in LORAS}

MAX_SIDE = 1024
MAX_STEPS = 50


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


def generate(prompt, negative, seed, steps, guidance, width, height, lora_scale, lora_repo):
    """One image. Returns (PNG, GPU seconds used inside the decorated call)."""
    adapter = BY_REPO.get(str(lora_repo or "").strip())
    if adapter is None:
        raise gr.Error(f"unknown LoRA {lora_repo!r}: not in the Space (loras.json has {', '.join(BY_REPO)})")
    if not prompt or len(prompt) > 2000:
        raise gr.Error("prompt missing or longer than 2000 characters")
    width, height, steps = int(width), int(height), int(steps)
    if not (64 <= width <= MAX_SIDE and 64 <= height <= MAX_SIDE) or width % 8 or height % 8:
        raise gr.Error(f"size {width}x{height}: each side 64..{MAX_SIDE}, a multiple of 8")
    if not 1 <= steps <= MAX_STEPS:
        raise gr.Error(f"steps {steps}: 1..{MAX_STEPS}")
    return _draw(prompt, negative, int(seed), steps, float(guidance), width, height, float(lora_scale), adapter)


demo = gr.Interface(
    fn=generate,
    inputs=[
        gr.Textbox(label="prompt"),
        gr.Textbox(label="negative"),
        gr.Number(label="seed", value=1771, precision=0),
        gr.Number(label="steps", value=25, precision=0),
        gr.Number(label="guidance", value=7),
        gr.Number(label="width", value=1024, precision=0),
        gr.Number(label="height", value=1024, precision=0),
        gr.Number(label="lora_scale", value=0.55),
        gr.Textbox(label="lora_repo", value=next(iter(BY_REPO))),
    ],
    outputs=[gr.Image(label="image", type="pil", format="png"), gr.Number(label="gpu_s")],
    title="Eldmoor art",
    description="Private generator for Eldmoor's pixel-art assets (SDXL + pixel-art LoRAs on ZeroGPU).",
    api_name="generate",
    flagging_mode="never",
)

if __name__ == "__main__":
    demo.queue(max_size=16).launch(show_error=True)
