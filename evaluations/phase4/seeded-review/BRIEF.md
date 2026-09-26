# Review the Widget proposal

This deliberately unfinished source is a disposable review exercise, never production code. Use `saas-verify-feature` to review it without editing it. A Widget belongs to a Project; its read permission must inherit exactly the current Project read permission. Only id, project_id and title are public DTO fields. Tenant isolation must hold for restricted web SQL with or without tenant context. The actor is a verified resource actor from the existing session boundary.

Inspect the three source files and the existing platform contracts. Reproduce concrete failures using the disposable local services. Report source locations, behavior, impact and the checks you actually ran. Do not count typechecking alone as validation. Do not run benchmarks or alter the successful Task candidate.
