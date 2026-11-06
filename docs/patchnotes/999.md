---
title: "Under the hood: a broken workflow file is caught before it blocks a pull request"
date: 2026-11-06
area: infra
issues: [597]
---
- Nothing you will notice: the rules check now fails, naming file and line, when a CI workflow has a comma in an unquoted step name or an unclosed step, which used to leave a pull request stuck with no failure shown.
