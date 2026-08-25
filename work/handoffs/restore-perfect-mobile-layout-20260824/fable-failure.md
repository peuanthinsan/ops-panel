# Fable review failure receipt

- Requested lane: `hybrid-fable-reviewer`
- Requested model/effort: Fable/high
- Permission mode: plan
- Result: the foreground Claude CLI invocation completed without returning a review payload or surface model metadata.
- Status: `INCOMPLETE`
- Visible fallback trigger: empty review output / missing model-provenance receipt.
- Authorized fallback: one fresh `hybrid-opus-reviewer` invocation at Opus/high in plan mode, as defined by the hybrid orchestration policy.

