---
name: natural-writing
description: Contains well-defined rules for creating natural, accurate, and readable writing. Use this skill whenever authoring longer text, including reports, PR or CL descriptions, READMEs, system designs, analysis documents, or general documentation.
---

# Rules for natural writing

This document outlines strict rules to avoid common "AI-isms": stylistic and structural patterns that language models typically fall into. Follow these rules to produce content that is more understandable, and reads as natural, human-authored text.

## 1. Vocabulary & phrasing controls

### The "banned" list

Avoid words that are statistically overrepresented in AI text. Use simpler, more direct alternatives.

Avoid verbs that are commonly overused, such as delve, underscore, highlight (as a verb), foster, cultivate, maximize, leverage, democratize, ensure, align with, resonate with, encompass, and bridge. Also avoid adverbs like seamlessly and extensively.

For nouns, avoid abstract uses of tapestry, landscape, realm, testament, interplay, synergy, cornerstone, hub, and ecosystem.

For adjectives, avoid puffery and vague descriptors like pivotal, crucial, vibrant, intricate, nuanced, unwavering, indelible, uncharted, rapidly evolving, transformative, breathtaking, nestled, dynamic, comprehensive, intuitive, holistic, robust, frictionless, scalable, and synergistic.

### Avoid "copula" substitutions

Do not replace simple "is" or "are" verbs with flowery equivalents.

- Instead of: "The library _serves as_ a center for learning."
- Write: "The library _is_ a center for learning."
- Instead of: "The statue _stands as_ a monument to..."
- Write: "The statue _is_ a monument to..."

### Eliminate "elegant variation"

Do not use synonyms just to avoid repeating a subject's name (e.g., "the eponymous character," "the titular protagonist," "the celebrated author"). It is acceptable to repeat the name or use pronouns naturally.

## 2. Content & tone

### No "puffery" or forced significance

Do not inflate the importance of a topic with vague praise. If a subject is important, the facts should demonstrate it without help.

Avoid phrases like "serves as a testament to," "marking a pivotal moment," "underscoring the importance of," "leaving an indelible mark," or "shaping the landscape."

- Instead of: "The founding of the institute marked a pivotal moment in the evolution of regional statistics, representing a significant shift toward independence."
- Write: "The institute was founded in 1989 to collect regional statistics."

### No superficial analysis

Avoid attaching "dangling" present-participle phrases that offer vague commentary.

Delete clauses starting with "highlighting," "emphasizing," "reflecting," "showcasing," or "demonstrating" if they just restate the obvious or add fluff.

- Instead of: "The building uses blue glass, _reflecting the region's natural beauty and symbolizing unity._"
- Write: "The building uses blue glass."

### Avoid promotional language

Maintain a neutral tone. Avoid "advertisement" words like boasts, features (as a verb), offers, premier, leading, state-of-the-art, committed to, and dedicated to.

- Instead of: "Nestled in the heart of the city, the hotel boasts a vibrant atmosphere."
- Write: "The hotel is located in the city center."

### No "challenges and future outlook" formula

Language models often end articles with a generic "Despite challenges... remains important" conclusion. Do not end with a summary paragraph starting with "Despite [X], [Subject] continues to..." or speculating on the future. End with the last fact.

- Bad: "Despite facing economic hurdles, the company continues to thrive and remains a beacon of innovation."

### No "title as proper noun" leads

Do not treat a descriptive article title (like a list or broad topic) as a proper noun in the first sentence.

- Instead of: "_The List of songs about Mexico_ is a curated compilation..."
- Write: "This list contains songs about Mexico..."

### No generic "see also" links

Do not populate "See Also" sections with broad, generic terms. Links must be directly relevant and specific to the subject.

- Bad: Linking _Financial technology_ in an article about a specific startup.
- Good: Linking a competitor or specific related technology.

### Attribution precision

Avoid vague "weasel words" like "Experts argue," "Observers have noted," or "Several sources indicate" unless you cite specific people immediately. Do not claim a subject interacts with a "broader" history or trend unless a source explicitly says so.

## 3. Sentence structure

### No negative parallelism

Avoid sentences that structure a contrast unnecessarily.

- Instead of: "It is _not only_ a painting, _but also_ a representation of..."
- Instead of: "It is _not_ just about X; _it is_ about Y."
- Write: "It is a painting that represents..."

### No "rule of three"

Avoid listing exactly three adjectives or three noun phrases to sound "comprehensive."

- Bad: "The event brings together _marketers, engineers, and designers_." (Unless those specific three groups are the _only_ ones).
- Bad: "It is _bold, innovative, and unique_."

### No false ranges

Do not use "from X to Y" unless X and Y are endpoints of a logical scale (like time or size).

- Instead of: "The book covers everything _from_ biology _to_ space travel." (These are just two random topics, not a range).
- Write: "The book covers topics including biology and space travel."

## 4. Structure & formatting

### Headers

Use sentence case for headers (e.g., "Early life," not "Early Life"). Do not use title case in headers.

### Formatting avoidance

Do not use inline-header lists (such as `* **Header:** Description...`). Instead, use prose or simple lists.

Avoid excessive bolding of keywords, "key takeaways," or names in the body text, except for the first mention in the lead.

Do not use emojis (🚀, 🧠) or unusual bullets (`#`, `-`) in lists. Use standard bullets (`*`).

Avoid creating tables for simple information that easily fits in a sentence.

Ensure markup is context-appropriate; do not use Markdown (like `##`) in formats that do not support it (like Wikitext) unless it is explicitly converted.

### Punctuation

Use straight quotes (`"`, `'`) and straight apostrophes (`'`). Do not use curly or smart quotes (`“`, `’`).

Use em dashes sparingly, as language models often overuse them for emphasis. Prefer commas or parentheses instead.

## 5. Citations & integrity

### No hallucinations

Never generate a citation unless you are looking at the source.
Do not invent URLs or DOIs.
Do not assume a book exists or contains a specific fact without verification.

## 6. Communication (chat context)

Avoid collaborative filler at the start of responses, such as "Certainly!", "Here is the information," or "I hope this helps." State the content directly.

Do not apologize for being an AI or mention knowledge cutoffs unless it is relevant to a specific, time-sensitive fact.

Do not preface responses with subject lines.

Keep edit summaries concise and informal, avoiding verbose paragraphs.
