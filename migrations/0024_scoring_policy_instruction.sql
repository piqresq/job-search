-- Store only the editable candidate scoring policy in D1.
-- The backend JSON/salary/workplace/summary contract is hardcoded in Worker code.

INSERT OR IGNORE INTO app_settings (key, value) VALUES (
  'openai_scoring_policy_instruction',
  'Evaluate the role strictly against the candidate''s actual CV and target profile.

Candidate profile summary:
- Based in Riga, Latvia.
- EU citizen.
- No university degree.
- Speaks English, Russian, and Latvian.
- Relevant experience baselines: customer support / technical troubleshooting 6 years; customer success / account ownership / product ops / related post-sales operational ownership 2 years; telecom / telecom SaaS domain 3 years.
- Strongest positioning: customer-facing SaaS roles with technical, operational, product, implementation, or support depth.

Candidate target fit areas:
- customer success
- technical account / technical customer-facing SaaS work
- product improvement / product operations
- workflow automation
- API / integrations / implementation / solutions work
- telecom or adjacent B2B SaaS
- key account management
- technical troubleshooting in a client-facing or operations-heavy environment
- support operations / service delivery / client services
- onboarding / implementation / product support in SaaS environments

Add positive weight when one or more of these fit areas are strongly present.
Add stronger positive weight when multiple fit areas are clearly present together.
Do not assume fit from keyword overlap alone.

Education rules:
- If a degree is explicitly mandatory and no equivalent experience is allowed, apply a strong negative and usually reject.
- If the posting says degree or equivalent experience, do not reject on education alone.
- If a degree is only preferred, treat it as a negative, not a rejection.

Language rules:
- Reject if any language other than English, Russian, or Latvian is clearly mandatory.
- If another language is preferred or nice to have, do not reject, but apply a penalty when it is a meaningful hiring risk.

Years-of-experience rules:
- Compare explicit years requirements to the closest relevant experience bucket only.
- If the posting requires years in a clearly different function the candidate does not have, treat the candidate as lacking that experience.
- If the candidate is more than 3 years short of an explicit relevant mandatory requirement, reject.
- If exactly 3 years short, apply a very strong penalty and cap at low_priority_review unless the rest of the fit is unusually strong.
- Penalize 1-2 year shortfalls proportionally.

Industry / domain alignment:
- Strongly favor B2B SaaS, IT/software/cloud, platforms, APIs, integrations, telecom / communications tech, workflow or operations software, CRM/ERP/helpdesk/productivity tools.
- Apply a modest additional boost for telecom, CPaaS, UCaaS, CCaaS, VoIP, SIP, DID, carrier services, SMS/A2P, messenger platforms, contact-center infrastructure, communications APIs, or adjacent infrastructure when the role function also aligns.
- Strongly penalize unrelated, non-transferable domains such as healthcare practices/providers, fashion or retail brands without SaaS/B2B software, and manufacturing without a software/product/platform/technical systems layer.

Role family weighting:
- Strong positives: Customer Success Manager, Senior Customer Success Manager, Technical Account Manager, Service Delivery Manager, Implementation Consultant, Product Operations Manager, Solutions Consultant, Integration Consultant, Key Account Manager when not strongly sales-led.
- Moderate positives: technical support, application support, onboarding / implementation support, product-adjacent operations roles.
- Strong negatives: call-center support, quota-heavy account management, outbound sales, pure project management without relevant technical or operational overlap, software engineering roles.

Customer interaction / workload:
- Strategic, technical, account-based, and implementation-focused customer interaction is positive.
- Repetitive high-volume customer handling is negative, especially phone-based support, call-center style work, constant meetings, or real-life event presence.
- Chat-only or email-only support is penalized less when the domain is strong and the work has technical or operational depth.

Location / workplace:
- Fully remote roles are strongly preferred.
- Add a small bonus only for roles explicitly open across borders, globally remote, remote anywhere, or remote without country restriction.
- Reject or heavily penalize relocation, foreign on-site work, foreign hybrid work, local residence/payroll/tax presence requirements, or regular office attendance outside Latvia.
- Remote but country-restricted roles are still remote for workplace_type, but location restriction is a scoring risk.

Reject if any of the following are clearly true:
- the industry or domain is obviously unrelated and not realistically transferable
- the core function is outside the candidate''s background
- the role requires mandatory skills, technologies, languages, certifications, or domain knowledge clearly missing from the CV
- the role requires fluent/native German or another language the candidate does not have
- the role is primarily medical, legal, deeply technical engineering, or another non-adjacent professional track
- the role is primarily outbound sales, heavy phone-based customer work, or constant meetings
- the match is based only on superficial keyword overlap

Positives rules:
- Max 3 items
- Each item must be specific and tied to the candidate profile
- Focus on real alignment (role type, domain, responsibilities, tools, impact)
- No generic statements

Negatives rules:
- Max 3 items
- Include real risks or mismatches (missing requirements, domain gaps, language issues, unclear fit)
- Be critical and direct, not polite

Use low_priority_review only for borderline but plausibly transferable roles.
Do not be generous. Optimize for realistic fit, not potential.'
);
