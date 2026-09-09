# The Complete AI Job Replacement Intelligence Report — 2024–2030

*A structured intelligence brief for workforce risk assessment*

---

## Executive Summary

Every major institutional forecast on AI and labor converges on the same structural conclusion, even where the headline numbers differ: AI is not primarily eliminating jobs wholesale — it is decomposing jobs into tasks, automating the routine and codifiable tasks first, and leaving humans holding the residual bundle of judgment, physical dexterity, relationship management, and accountability. McKinsey Global Institute estimates generative AI could automate activities equivalent to 29.5% of current U.S. work hours by 2030, up from a pre-generative-AI baseline of 21.5%. Goldman Sachs puts the number at roughly two-thirds of U.S. and European jobs exposed to some degree of AI automation, with the equivalent of 300 million full-time jobs exposed globally. The IMF finds 40% of global employment exposed, rising to 60% in advanced economies. OpenAI and University of Pennsylvania researchers found 80% of the U.S. workforce could see at least 10% of tasks affected, and 19% could see over half their tasks affected. The World Economic Forum's 2025 Future of Jobs Report projects 92 million jobs displaced and 170 million created by 2030 — a net gain of 78 million, but with enormous churn and a requirement that 39% of core skills be relearned.

None of these reports predict mass unemployment as a base case. All of them predict mass task-level disruption, a widening gap between AI-augmented and AI-naive workers within the same profession, and a labor market where the median worker's job description in 2030 looks meaningfully different from 2024 — even if the job title hasn't changed. This report synthesizes that research into a usable diagnostic framework: what AI can and can't do today, how risk breaks down by industry and role, why augmentation is outpacing outright replacement almost everywhere, what structural barriers slow automation even when it's technically possible, and a scoring rubric that converts all of this into a single number a person can apply to their own job.

---

## 1. AI Capability Tiers: What AI Can and Can't Do Today

### 1.1 Tasks AI Handles at Human Level or Better

As of 2026, generative and predictive AI systems perform at or above competent-human level on a specific, well-defined set of task types:

- **Structured data entry, extraction, and reconciliation.** OCR plus LLM pipelines now outperform manual entry on speed and rival it on accuracy for invoices, forms, and structured documents.
- **Translation between major world languages.** Neural machine translation combined with LLM post-editing produces publication-quality output for most business and technical text, collapsing the need for first-pass human translation on high-volume, non-literary content.
- **Boilerplate code generation and scaffolding.** Coding agents such as Claude Code, Cursor, GitHub Copilot's agent mode, and Devin now write, test, and submit pull requests with minimal supervision on well-scoped tasks. Independent benchmark tracking (SWE-bench Verified) shows leading agents solving roughly 70–77% of real-world GitHub issues autonomously in 2025–2026, up from under 14% for the first agentic coding tools in early 2024 — one of the fastest capability curves of any occupational category.
- **Static image generation.** Midjourney, DALL-E, Adobe Firefly, and Google's image models now produce commercial-grade concept art, stock photography substitutes, and marketing visuals in seconds.
- **Tier-1 customer service.** LLM-based chat and voice agents resolve a large share of routine support tickets (password resets, order status, FAQ-type queries) without escalation.
- **First-pass legal and compliance document review.** Contract review tools flag non-standard clauses, missing terms, and risk language faster and more consistently than junior associates performing the same triage.
- **Radiology and pathology image triage.** FDA-cleared AI tools now match or exceed average radiologist performance on specific narrow tasks — such as flagging likely fractures, certain cancers on mammograms, and diabetic retinopathy — though only as a triage/second-read layer, not a replacement for the interpreting physician.
- **Drafting and summarization.** First-draft memos, meeting summaries, marketing copy, and routine correspondence are now reliably AI-assisted across nearly every knowledge-work function.

### 1.2 Tasks AI Still Fails At

- **Physical dexterity in unstructured environments.** Despite heavy investment, humanoid robotics remains far from broad deployment. Tesla's own Q4 2025 and Q1 2026 earnings calls acknowledged Optimus was "not in usage in our factories in a material way," with 2025 production landing at a small fraction of the 5,000-unit internal target — a useful corrective to viral claims of tens of thousands of robots already "replacing" factory workers. Plumbing, electrical work, elder care lifting and bathing, and general construction remain effectively unautomatable at commercial scale today.
- **Genuine emotional intelligence and trust-building.** AI can simulate empathetic language, but cannot yet substitute for a therapist building a therapeutic alliance, a nurse comforting a frightened patient, or a hospice worker present at end of life.
- **Complex, high-stakes negotiation.** Multi-party negotiations involving incomplete information, relationship capital, and long time horizons (M&A deals, labor contracts, diplomatic negotiations) remain human-led; AI serves as a research and modeling aid at best.
- **Novel creative direction.** AI can execute within an established style near-instantly, but originating a new visual language, narrative structure, or brand identity from a blank page — the kind of judgment a creative director exercises — remains a human function.
- **Crisis leadership and accountable decision-making under ambiguity.** When information is incomplete and stakes are high (a plant safety incident, a hospital mass-casualty event, a company's response to a scandal), organizations still require a human who can be held accountable and who can adapt on the fly to social and political context AI cannot fully model.
- **Ethical judgment in genuinely novel situations.** AI systems apply patterns learned from training data; they do not reliably generalize ethical reasoning to situations with no close precedent.

### 1.3 The "Last Mile" Problem: Why 80% Automation ≠ Full Replacement

The consistent finding across the McKinsey, OpenAI/Penn, and Goldman Sachs research is that *task* exposure is measured in the 40–80% range for a large share of occupations, but *occupation* elimination remains rare. This is the last-mile problem: a role rarely consists of one homogeneous task. A paralegal's job might be 70% automatable research and drafting, but the remaining 30% — client communication, exercising judgment about which precedents actually matter to a specific case, appearing in court-adjacent contexts, and taking professional responsibility for the work product — cannot yet be automated and cannot easily be unbundled into a separate job. Employers rarely fire the paralegal and just buy the AI tool; more often, one paralegal using AI does the work that previously took three, and the total headcount for the function shrinks over a multi-year attrition curve rather than a single layoff event. This is why aggregate task-automation percentages of 30–70% coexist with actual occupational employment declines that are far smaller and slower.

---

## 2. Industry-by-Industry Risk Analysis

For each role below: **Risk Level** (Low/Medium/High/Very High), **Timeline** for displacement to become visible in employment data, key **automatable tasks**, and what the role **evolves into**.

### 2.1 Tech & Software

| Role | Risk | Timeline | Automatable Tasks | Evolves Into |
|---|---|---|---|---|
| Junior/entry-level developer | High | Now–2027 | Boilerplate code, unit tests, bug fixes, documentation | "AI orchestrator" who reviews, integrates, and architects rather than hand-writes every line |
| Senior/staff developer | Low–Medium | 2027–2030 | Routine refactors, migrations, code review triage | System architecture, cross-team technical strategy, AI-agent supervision |
| QA/manual testers | Very High | Now–2026 | Regression testing, test-case generation | Test strategy design, exploratory/edge-case testing AI misses |
| DevOps/SRE | Medium | 2026–2029 | Routine deployment scripts, log triage, alert response | Incident architecture, reliability strategy, security hardening |
| Product manager | Low–Medium | 2027–2030 | Requirements docs, competitive research, spec drafting | Stakeholder alignment, prioritization judgment, customer discovery |
| UI/UX designer | Medium | 2025–2028 | Wireframes, component variations, A/B test copy | Design strategy, user research synthesis, brand judgment |

The rapid rise of agentic coding tools is the single fastest-moving data point in this entire report. Adoption surveys through early-to-mid 2026 show a majority of professional developers now using AI coding tools daily, with agent sessions growing from a few minutes of assisted autocomplete to 20-plus-minute autonomous task completions. This has already begun compressing hiring for junior developer and QA roles at some firms, even as senior engineering headcount and AI-infrastructure hiring both continue to grow — a bifurcation, not a collapse.

### 2.2 Finance & Accounting

| Role | Risk | Timeline | Automatable Tasks | Evolves Into |
|---|---|---|---|---|
| Bookkeepers/junior accountants | Very High | Now–2027 | Reconciliation, categorization, basic tax prep | Advisory accounting, controller-level judgment |
| Financial analysts | Medium–High | 2025–2028 | Model-building, comp sets, first-draft memos | Investment thesis development, client-facing strategy |
| Auditors | Medium | 2026–2029 | Sampling, anomaly detection, documentation review | Fraud investigation judgment, regulatory interpretation |
| Traders (execution) | High | Already underway | Algorithmic execution has displaced most manual order execution over the past decade | Strategy design, risk oversight of algorithmic systems |
| Financial advisors | Low–Medium | 2028–2032 | Portfolio rebalancing, basic planning | Behavioral coaching, complex estate/tax planning, trust-building |

### 2.3 Healthcare

| Role | Risk | Timeline | Automatable Tasks | Evolves Into |
|---|---|---|---|---|
| Radiologists | Medium | 2027–2032 | First-pass image flagging, measurement, triage | Complex-case interpretation, procedural work, AI-output arbitration |
| Nurses | Low | Beyond 2030 | Documentation, vitals logging, scheduling | Direct patient care remains the core, harder-to-automate function |
| Pharmacists | Medium | 2026–2030 | Dispensing verification, drug-interaction checks | Clinical consultation, medication therapy management |
| Primary care physicians | Low–Medium | 2028–2032 | Documentation, triage, differential-diagnosis support | Diagnostic judgment, relationship-based care, complex case management |
| Surgeons | Low | Beyond 2030 | Pre-op planning, robotic-assist precision tasks | Surgical judgment and dexterity remain firmly human; robotics assists rather than replaces |
| Therapists/counselors | Low | Beyond 2030 | Intake notes, scheduling, basic psychoeducation content | The therapeutic relationship itself is the least automatable service in healthcare |

Healthcare consistently ranks as one of the least-exposed sectors across every major report cited in Section 5, largely because of the combination of regulatory licensure requirements, malpractice liability structures, and the simple fact that patients strongly prefer a human for anything involving their body or a life-and-death decision.

### 2.4 Legal

| Role | Risk | Timeline | Automatable Tasks | Evolves Into |
|---|---|---|---|---|
| Paralegals/legal researchers | High | Now–2028 | Document review, discovery, legal research memos | Case strategy support, client liaison, court logistics |
| Contract reviewers | Very High | Now–2027 | Standard-clause review, redlining against a playbook | Complex negotiation, novel-clause drafting |
| Compliance officers | Medium | 2026–2029 | Monitoring, flagging, routine filings | Regulatory judgment calls, enforcement strategy |
| Litigators/trial lawyers | Low | Beyond 2030 | Discovery review, brief drafting support | Courtroom advocacy, jury persuasion, negotiation remain human |

Legal services and administrative work were independently flagged by Goldman Sachs, and by earlier Princeton/Penn/NYU research, as among the occupational categories most exposed to large language models — largely because so much legal work is language-in, language-out.

### 2.5 Education

| Role | Risk | Timeline | Automatable Tasks | Evolves Into |
|---|---|---|---|---|
| Tutors (subject-specific) | Medium–High | Now–2028 | Homework help, practice problems, basic explanation | Motivation coaching, learning-plan design for struggling students |
| K-12 teachers | Low | Beyond 2030 | Lesson-plan drafting, grading, worksheet generation | Classroom management, mentorship, differentiated instruction |
| Curriculum designers | Medium | 2026–2029 | First-draft content, alignment to standards | Pedagogical strategy, cross-disciplinary design judgment |
| Administrators | Medium | 2026–2030 | Scheduling, reporting, routine correspondence | Policy and personnel judgment |

### 2.6 Creative Industries

| Role | Risk | Timeline | Automatable Tasks | Evolves Into |
|---|---|---|---|---|
| Stock/commercial photographers | Very High | Now–2026 | Generic stock imagery, product mockups | Bespoke commercial shoots, art direction |
| Graphic designers (production) | Medium–High | Now–2028 | Layout variations, social assets, resizing | Creative direction, brand strategy |
| Video editors (rough cut) | Medium–High | 2025–2028 | Rough cuts, transcription-based editing, basic color | Narrative structure, final creative judgment |
| Illustrators/concept artists | High | Already underway | Concept iterations, background art, style exploration | Original IP development, art direction |
| Musicians (session/library) | High | Now–2027 | Stock/library music, jingles, background scoring | Live performance, original composition with artistic voice |
| Writers (commodity content) | High | Already underway | SEO listicles, product descriptions, templated content | Investigative, narrative, and voice-driven writing |

A 2024 industry survey commissioned by the Concept Art Association and the Animation Guild found that three-quarters of entertainment-industry leaders reported AI tools had already contributed to job elimination, reduction, or consolidation, with an estimated 204,000 positions expected to be adversely affected within three years — one of the starkest sector-specific figures in this report. At the same time, BLS projections for graphic designers still show modest positive growth through 2034, illustrating the core tension: aggregate occupational headcounts can grow slightly even as the nature and volume of entry-level production work collapses.

### 2.7 Marketing & Sales

| Role | Risk | Timeline | Automatable Tasks | Evolves Into |
|---|---|---|---|---|
| Copywriters (performance/direct response) | High | Now–2027 | Ad copy variations, email sequences, product descriptions | Brand voice strategy, campaign concepting |
| SEO specialists | High | Already underway | Keyword research, on-page optimization, content briefs | Search-strategy judgment as AI search reshapes discovery itself |
| Marketing analysts | Medium | 2026–2029 | Reporting, dashboarding, basic attribution | Strategic interpretation, budget allocation judgment |
| Sales development reps (SDRs) | High | Now–2027 | Prospecting, first-touch outreach, qualification | Complex deal negotiation, relationship management |
| Account executives | Low–Medium | 2028–2031 | CRM updates, proposal drafting | Relationship-based closing, trust-building |

### 2.8 Manufacturing & Logistics

| Role | Risk | Timeline | Automatable Tasks | Evolves Into |
|---|---|---|---|---|
| Warehouse pickers/packers | Medium–High | 2027–2032 | Repetitive picking in structured environments | Exception-handling, robot supervision — timeline pushed out by the slower-than-hyped pace of humanoid robot deployment |
| Long-haul truck drivers | Medium | 2028–2033 | Highway driving on mapped, low-complexity routes | Last-mile/complex driving, logistics coordination — still bottlenecked by regulation and edge-case handling |
| Factory line operators | Medium | 2027–2032 | Repetitive assembly tasks in controlled environments | Line supervision, quality judgment, robot maintenance |
| Quality control inspectors | Medium–High | 2026–2029 | Visual defect detection on standardized parts | Root-cause investigation, supplier relationship management |

Robotics and autonomous-vehicle timelines are consistently the most overstated in public discourse and the most delayed in practice. Even Tesla's own leadership has publicly walked back near-term Optimus production claims, and Waymo's own executives have stated publicly that robotaxi expansion will still require substantial human employment in vehicle servicing, fleet operations, and technician roles — an estimated 190 human jobs to build, service, and support every 1,000 autonomous vehicles deployed annually, according to a 2025 Goldman Sachs analysis. Early data from ride-hail markets where robotaxis now operate shows human drivers losing single-digit percentages of trip volume, not their jobs outright, as of early 2026.

### 2.9 Customer Service

| Role | Risk | Timeline | Automatable Tasks | Evolves Into |
|---|---|---|---|---|
| Tier-1 call center agents | Very High | Now–2026 | FAQ resolution, order status, password resets | Escalation handling, emotionally complex complaints |
| Tier-2/3 support specialists | Medium | 2027–2030 | Troubleshooting scripts, ticket triage | Complex technical diagnosis, relationship recovery |
| Community managers | Low–Medium | 2027–2030 | Content scheduling, first-response drafting | Brand voice judgment, crisis communication |

### 2.10 Other Fields

- **Real estate agents** (Low–Medium risk, 2028+): AI already automates listing descriptions, comparative market analyses, and lead qualification, but the relationship-heavy, high-stakes, trust-dependent nature of home buying keeps agents relevant; the role shifts toward negotiation and advisory work.
- **HR (recruiting/screening)** (High risk, now–2027): resume screening, interview scheduling, and first-pass candidate matching are heavily automated already; HR business partner and employee-relations roles remain far more insulated.
- **Journalism** (High risk for commodity reporting, now–2027; Low risk for investigative/opinion work): earnings summaries, sports recaps, and templated local news are already substantially automated at wire services; original reporting, source relationships, and editorial judgment remain human.
- **Architecture** (Low–Medium risk, 2028+): AI accelerates rendering, code-compliance checking, and generative floor-plan options, but licensure, liability, and client-relationship-driven design judgment anchor the profession.

---

## 3. The Augmentation vs. Replacement Framework

### 3.1 Why Most Jobs Transform Rather Than Disappear

Every major institutional study cited in this report — McKinsey, WEF, Goldman Sachs, IMF, OpenAI/Penn — reaches a version of the same conclusion: the dominant mode of AI's labor-market effect is *task substitution within a job*, not *occupation elimination*. WEF's 2025 report frames this explicitly around a 39% "skills half-life" — the share of core skills expected to become outdated by 2030 — which describes evolution, not extinction, of most job categories. The occupations WEF and BLS both flag as facing outright category decline (typists, switchboard operators, data-entry clerks, telemarketers) are notably narrow, clerical, and were already shrinking pre-ChatGPT due to earlier waves of software automation.

### 3.2 The "Centaur Model"

Named after the human-plus-chess-engine teams that outperformed both solo grandmasters and solo engines in early "freestyle chess," the centaur model describes the pattern now observed across law, medicine, coding, and finance: a competent human paired with an AI system consistently outperforms either the unaided human or the unsupervised AI alone, particularly on tasks requiring judgment about which of several AI-generated options is actually correct or appropriate. Radiology is the clearest applied example — AI-assisted radiologists show improved detection rates over unassisted radiologists, while AI alone (without radiologist sign-off) remains unsuitable for autonomous diagnosis in nearly every jurisdiction due to liability and accuracy-in-the-tail-case concerns.

### 3.3 10x Productivity vs. Obsolescence

The dividing line between "AI makes you 10x more productive" and "AI makes you unnecessary" tracks closely with how much of the role's value comes from *judgment, accountability, and relationship* versus *throughput on a well-specified task*. A senior software engineer who can now direct multiple AI coding agents in parallel and review their output is a 10x case. A data-entry clerk whose entire job was throughput on a well-specified task has no judgment layer left once that throughput is automated — this is the obsolescence case. The practical takeaway: workers should audit what percentage of their role's value is throughput versus judgment, because that ratio predicts which side of this line they land on.

### 3.4 Historical Precedent

- **ATMs and bank tellers**: ATMs proliferated from the 1970s onward, yet the number of bank teller jobs in the U.S. grew for decades afterward, because ATMs lowered the cost of operating a branch, which led banks to open more branches, each needing tellers for roles ATMs couldn't do (sales, advice, complex transactions). Teller employment did eventually decline as digital and mobile banking reduced branch traffic overall — but that decline took roughly 40 years, not months.
- **Spreadsheet software and accountants/bookkeepers**: Excel and its predecessors eliminated the manual ledger-clerk function almost entirely, yet the number of practicing accountants grew, because the profession's center of gravity shifted from arithmetic to advisory work that spreadsheets made cheaper to deliver.
- **The caution**: past general-purpose technologies automated *physical or arithmetic* tasks and left *cognitive/language* judgment to humans by default. Generative AI is the first general-purpose technology to meaningfully encroach on cognitive and language tasks themselves, which is why economists including those at the IMF explicitly flag this transition as structurally different from prior automation waves — the same optimistic historical pattern is not guaranteed to repeat on the same timeline or with the same outcome.

---

## 4. The Automation Resistance Factors

Even where AI is technically capable of performing a task, five categories of friction slow real-world adoption and protect human employment longer than raw capability alone would predict.

### 4.1 Regulatory Barriers
Healthcare, law, aviation, and financial advice are all licensure-gated professions where a human must legally sign off on the final decision. The FDA requires clinical validation and a human-in-the-loop for diagnostic AI; the FAA requires certified human pilots regardless of autopilot sophistication; most U.S. states require a licensed attorney to represent a client in court. These are not technology limits — they are legal ones, and they change on legislative timelines, not technology-release timelines.

### 4.2 Trust Barriers
Surveys consistently find the public far more comfortable with AI assisting a human professional than replacing one outright, especially in surgery, therapy, and childcare-adjacent roles. This "would you let AI do your surgery?" resistance is a real market force: even a technically superior AI-only service can fail commercially if consumers won't buy it, which is part of why nearly every AI diagnostic and legal tool on the market today is marketed as an assistive "copilot" rather than an autonomous replacement.

### 4.3 Physical World Barriers
Plumbing, electrical work, elder care, construction, and most skilled trades require dexterity, mobility, and adaptability to unstructured physical environments that remain well beyond current robotics — a gap made vivid by the disconnect between viral claims of humanoid robots "already working" in factories and Tesla's own 2026 earnings-call admission that Optimus was not yet contributing materially to production. These trades are widely expected to remain among the most durable, AI-resistant careers through 2030 and likely well beyond.

### 4.4 Liability Barriers
When an AI system makes a consequential error — a missed cancer diagnosis, a bad legal filing, a self-driving car collision — the question of who is legally responsible remains unresolved in most jurisdictions. Until liability frameworks mature, organizations have a structural incentive to keep an accountable human formally in the loop even in cases where the AI does most of the actual work, because insurance, malpractice, and tort law are all built around identifiable human or corporate responsibility.

### 4.5 Cost Barriers
AI is not always cheaper than a human once total cost of ownership is considered: compute costs, integration engineering, ongoing maintenance, error-correction overhead, and the cost of the human oversight still required. For low-wage, highly variable physical tasks (a domestic cleaner, a short-order cook), a human remains cheaper than a general-purpose robot capable of the same flexibility, which is a major reason humanoid robotics has consistently missed its own announced deployment timelines.

---

## 5. Real Statistics & Reports

| Source | Year | Key Finding |
|---|---|---|
| McKinsey Global Institute | 2023–2024 | Generative AI could push automatable work-hour share in the U.S. from 21.5% to 29.5% by 2030; up to 30% of hours worked across the U.S. economy could be automated by 2030; broader technical automation potential reaches 60–70% of activities in some worker archetypes when combined with pre-generative-AI automation |
| World Economic Forum, Future of Jobs Report 2025 | 2025 | Survey of 1,000+ employers across 55 economies: 92 million jobs displaced, 170 million created, net +78 million by 2030; 40% of employers expect workforce reductions where AI can automate tasks; 39% of core skills expected to become outdated by 2030; 59% of the global workforce will need reskilling |
| Goldman Sachs, "The Potentially Large Effects of Artificial Intelligence on Economic Growth" | 2023 | Generative AI could expose the equivalent of 300 million full-time jobs to automation globally; roughly two-thirds of U.S. and European jobs exposed to some degree of AI automation; could substitute up to a quarter of current work tasks; legal and administrative roles flagged as most exposed |
| OpenAI / University of Pennsylvania, "GPTs are GPTs" | 2023 | ~80% of the U.S. workforce could have at least 10% of tasks affected by GPT-class models; ~19% could see over 50% of tasks affected; exposure rises with income level; programming and writing skills show strong positive association with exposure, while science and critical-thinking skills show negative association |
| U.S. Bureau of Labor Statistics, Employment Projections 2023–2033 | 2024 | Total U.S. employment projected to grow only 0.4%/year (vs. 1.3%/year in the prior decade); office/administrative support occupations explicitly cited as declining due to "automated systems and related technology, including AI"; cashiers projected to lose the largest absolute number of positions (over 350,000); word processors/typists the fastest-shrinking occupation by percentage |
| International Monetary Fund, "Gen-AI: Artificial Intelligence and the Future of Work" | 2024 | Roughly 40% of global employment exposed to AI; exposure rises to about 60% in advanced economies versus roughly 30% in developing economies such as India, largely reflecting differences in the share of the workforce in agriculture; IMF explicitly warns of a widening income-inequality effect between AI-complemented and AI-substituted workers |

---

## 6. The "AI-Proof" Career Playbook

### 6.1 Skills That Become More Valuable as AI Spreads
- **Judgment under ambiguity** — knowing which of several plausible AI outputs is actually correct or appropriate for the situation.
- **Taste and creative direction** — originating a point of view rather than executing within one.
- **Relationship capital and trust** — clients, patients, and colleagues who choose to work with a specific person, not just a service.
- **Physical dexterity in unstructured settings** — skilled trades remain durable precisely because robotics lags cognitive AI by years, possibly decades.
- **Cross-domain synthesis** — connecting insights across fields in ways that go beyond pattern-matching within one domain.
- **Accountability and licensure** — professions where a human must be legally responsible retain structural protection regardless of AI capability.

### 6.2 Positioning as an AI-Augmented Professional
The evidence across every sector in Section 2 points to the same practical move: shift time away from the portion of your role that is throughput on well-specified tasks, and toward the portion that is judgment, oversight, and relationship. Concretely, this means learning to direct AI tools rather than compete with them — the developer who orchestrates several coding agents, the analyst who uses AI to build ten models and picks the right one, the designer who directs AI generation toward a coherent brand vision.

### 6.3 Career Pivots That Make Sense
- Production-heavy creative roles (junior designer, stock photographer, commodity copywriter) → creative direction, brand strategy, art direction.
- Junior legal/paralegal research → paralegal-to-compliance or paralegal-to-case-management tracks with more client-facing responsibility.
- Entry-level coding → full-stack/systems roles with architecture and AI-agent supervision responsibility.
- Tier-1 support → technical escalation specialties or customer-success roles with retention/relationship accountability.
- Any high-volume clerical role → skilled trades or care-economy roles, both of which WEF's 2025 report flags among the fastest-growing categories globally due to their resistance to automation.

### 6.4 AI-Resistant vs. AI-Complementary
"AI-resistant" roles are structurally hard to automate regardless of how a worker uses AI tools — most skilled trades, most direct patient care, most roles requiring physical presence in unstructured environments. "AI-complementary" roles are ones where AI dramatically increases output per worker, and the role does not disappear because judgment, accountability, or relationship-management remains the bottleneck — most of knowledge work falls here. The distinction matters for career planning: AI-resistant roles offer durability, but AI-complementary roles offer the more attainable 10x productivity upside for people who reposition quickly.

---

## 7. Scoring Rubric for AI Job Replacement Risk

Score a role on each dimension, then sum to a 0–100 total.

| Dimension | Points | Scoring Guide |
|---|---|---|
| **Routine/repetitive task share** | 0–20 | 0–5 = task is mostly novel/variable each time; 15–20 = task is highly repetitive and follows the same steps daily |
| **Physical presence requirement** | 0–15 | 0–3 = fully remote/digital work possible; 12–15 = requires hands-on physical presence and dexterity in unstructured settings |
| **Creative/strategic thinking requirement** | 0–15 | 0–3 = role requires original strategy or creative direction; 12–15 = role follows established templates/playbooks |
| **Emotional intelligence requirement** | 0–15 | 0–3 = role is relationship- and trust-dependent (therapy, sales closing, leadership); 12–15 = minimal interpersonal component |
| **Regulatory/liability protection** | 0–10 | 0–2 = licensure/legal liability requires a human sign-off; 8–10 = no regulatory barrier to full automation |
| **Current AI tool maturity for this role** | 0–15 | 0–3 = no mature AI tools exist yet for this task type; 12–15 = mature, widely adopted AI tools already perform this task well |
| **Economic incentive to automate** | 0–10 | 0–2 = automation would save little (low-cost labor, low volume); 8–10 = high-volume, high-cost labor with strong ROI to automate |

**Total: 0–100**

### Scoring Interpretation Guide

- **0–25 — AI-Proof:** Your job is safe for the foreseeable future. AI will be a peripheral tool, not a core threat, through at least 2030.
- **26–50 — Low Risk:** AI will change your tools, not replace you. Expect new software in your workflow, not a shrinking role.
- **51–70 — Medium Risk:** Significant parts of your role will be automated within 3–5 years. Start shifting your time toward the judgment/relationship portion of the job now.
- **71–85 — High Risk:** Your role will look fundamentally different within 2–3 years. Actively build the adjacent, less-automatable skills identified in Section 6.
- **86–100 — Critical Risk:** Active displacement is happening now. Pivot immediately toward an adjacent role with a materially lower score.

---

## 8. Latest AI Developments Impacting Jobs (2024–2026)

### 8.1 Knowledge Work: GPT-4-class Models, Claude, and Gemini
The generation of models that followed GPT-4 — including successive Claude, Gemini, and GPT releases — extended reliable performance from short-form drafting into long-context reasoning, multi-step research, and increasingly autonomous execution. This is the direct driver behind the task-exposure estimates from OpenAI/Penn, McKinsey, and Goldman Sachs cited in Section 5; those studies were explicitly built around this model generation's capabilities.

### 8.2 AI Coding Agents
This is the fastest-moving front in the entire report. Benchmark scores on SWE-bench Verified — a test of real-world GitHub issue resolution — rose from roughly 14% for early agentic tools in 2024 to 70–77% for leading agents (Claude Code, Devin 2.0) by 2025–2026. Adoption data through early-to-mid 2026 shows the AI coding-tool market itself reshaping rapidly, with tools built around autonomous multi-file, multi-step task execution (rather than simple autocomplete) becoming the developer preference. This has begun compressing demand for junior developers and manual QA specifically, even as overall software employment continues to grow.

### 8.3 AI Video and Image Generation
Tools including Midjourney, Runway, OpenAI's Sora, and Google's Veo moved from novelty to production-adjacent use in creative workflows between 2024 and 2026, with commercial designers reporting integration of AI generation into concept, mood-boarding, and first-draft asset production as standard practice. Industry-commissioned research from the Concept Art Association and Animation Guild found a substantial share of entertainment-industry leaders reporting AI-driven job elimination or consolidation already underway, with a six-figure estimate of affected positions over a multi-year window — a more severe near-term impact than in most other creative-adjacent categories, even though official government projections for design occupations broadly still show modest net growth.

### 8.4 Robotics: Tesla Optimus, Figure, Boston Dynamics
Robotics is the category where public perception and verified reality diverge most sharply. Independent 2026 reporting found that widely circulated claims of tens of thousands of humanoid robots already working in factories were not substantiated by the companies themselves, and that Tesla's own executive team stated on consecutive earnings calls that Optimus was not yet contributing materially to factory output, with actual 2025 production landing well below internal targets due to supply-chain and hand-mechanism engineering delays. Figure AI and Agility Robotics have more verifiable, if still narrow, deployment records at specific industrial sites. The practical implication for this report's timelines: physical-labor automation via humanoid robotics should be modeled as later and slower than headlines suggest, likely with meaningful commercial-scale deployment concentrated in 2027 and beyond rather than already underway at scale.

### 8.5 Self-Driving Progress and Transportation Jobs
Waymo's robotaxi service scaled from roughly 50,000 weekly paid rides in mid-2024 to roughly 500,000–1,000,000 by early-to-mid 2026 across an expanding list of U.S. cities, representing the clearest real-world autonomous-vehicle deployment at commercial scale to date. Early data from markets where robotaxis operate shows human rideshare drivers losing a measurable but modest share of trip volume (roughly 3–5% in the most-exposed metro areas as of late 2025) rather than being displaced outright, and Waymo's own leadership has publicly emphasized that scaling the service still requires substantial human employment in vehicle operations, maintenance, and fleet servicing roles. Long-haul trucking automation remains earlier-stage and more regulation-constrained than robotaxi services, with most industry timelines still pointing to the late 2020s for meaningful highway-segment automation at scale.

---

## Closing Analysis

Read together, these findings support a specific, non-alarmist but non-complacent conclusion: the labor market disruption from AI through 2030 will be real, large, and uneven — concentrated in roles that are language-heavy, template-driven, and low on relationship or physical-dexterity requirements — while remaining far more gradual, and far more mediated by regulation, liability, trust, and cost than the most viral automation headlines suggest. The single highest-leverage action available to any worker is not predicting which exact year their job disappears, but auditing which share of their current role is throughput versus judgment, and moving deliberately toward the judgment side before the market forces the move for them.
