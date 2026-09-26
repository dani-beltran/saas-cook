/** Seeded benchmark Projects start without a parent; each has one writer. */
export class ParentMoveWorkload {
	private readonly parents = new Map<string, string>();
	private verifiedChanges = 0;
	private initialAssignments = 0;
	private betweenWorkspaces = 0;
	private toFirstWorkspace = 0;
	private toSecondWorkspace = 0;
	private invalidMoves = 0;

	async move<T extends { id: string; workspaceId: string | null }>(
		projectId: string,
		workspaces: readonly [string, string],
		measured: boolean,
		perform: (workspaceId: string) => Promise<T>,
	): Promise<T> {
		const previous = this.parents.get(projectId) ?? null;
		const destination =
			previous === workspaces[0] ? workspaces[1] : workspaces[0];
		if (workspaces[0] === workspaces[1] || destination === previous) {
			this.invalidMoves++;
			throw new Error("Benchmark move must change the Project parent");
		}
		const result = await perform(destination);
		if (result.id !== projectId || result.workspaceId !== destination) {
			this.invalidMoves++;
			throw new Error("Benchmark move response did not confirm the new parent");
		}
		// Advance only after a successful response, including during warm-up.
		this.parents.set(projectId, destination);
		if (measured) {
			this.verifiedChanges++;
			if (previous === null) this.initialAssignments++;
			else this.betweenWorkspaces++;
			if (destination === workspaces[0]) this.toFirstWorkspace++;
			else this.toSecondWorkspace++;
		}
		return result;
	}

	evidence(successfulMoves: number) {
		return {
			verifiedChanges: this.verifiedChanges,
			initialAssignments: this.initialAssignments,
			betweenWorkspaces: this.betweenWorkspaces,
			toFirstWorkspace: this.toFirstWorkspace,
			toSecondWorkspace: this.toSecondWorkspace,
			invalidMoves: this.invalidMoves,
			valid:
				this.invalidMoves === 0 &&
				this.verifiedChanges === successfulMoves &&
				this.betweenWorkspaces > 0 &&
				this.toFirstWorkspace > 0 &&
				this.toSecondWorkspace > 0,
		};
	}
}
