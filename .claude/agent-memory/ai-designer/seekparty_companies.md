---
name: seekparty-companies
description: #510 scripted recruiting (seekParty) skips heroes with a company, uses a.company!=null not companyOf
metadata:
  type: project
---

seekParty skips the seeker and every candidate with `company != null` (apart-world solos/pairs), like Fellowship members.

**Why:** a scripted party pulled in an agent solo, whose scripted DM rolls then opened Table scenes for its company.
**How to apply:** do not import company.js into party.js (circular: HEALERS init error via fellowship.js); test the raw field. Together-world hashes are unchanged (companycheck has the case).
