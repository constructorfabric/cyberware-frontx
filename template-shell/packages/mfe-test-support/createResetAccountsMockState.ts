export function createResetAccountsMockState<TMockUser>(
  createDefaultAccountsMockUser: () => TMockUser,
  replaceCurrentAccountsMockUser: (nextUser: TMockUser) => void,
): () => void {
  return (): void => {
    replaceCurrentAccountsMockUser(createDefaultAccountsMockUser());
  };
}
