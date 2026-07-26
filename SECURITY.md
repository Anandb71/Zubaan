# Security

## Credential status

The hackathon session exposed development credentials in interactive output.
Rotate all of the following before deploying or sharing access:

- Sarvam API key
- Supabase secret/service key
- Supabase database password

Do not reuse those values in production.

## Reporting

Report suspected vulnerabilities privately to the repository maintainers. Do
not include customer transcripts, raw attachments, tokens, or database exports
in an issue.

## Data-handling rules

- Raw conversations and attachments are private tenant data.
- Audio and audit artifacts use private buckets and short-lived signed URLs.
- Provider credentials stay server-side; clients receive sanitized events.
- Unknown speakers, internal notes, and drafts are never treated as customer-
  visible agent claims.
- Every compliance finding must retain immutable trigger and source evidence.
- Retention and deletion apply to raw artifacts, normalized messages, derived
  findings, and generated audio independently.
