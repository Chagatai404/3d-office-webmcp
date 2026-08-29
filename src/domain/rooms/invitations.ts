/**
 * Invitation link shape. Kept in the domain layer so HTTP routes, clients and
 * tests build the same URL, and so no raw token ever has to be formatted twice.
 */
export function buildInviteUrl(
  baseUrl: string,
  roomId: string,
  inviteToken: string,
): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/room/${encodeURIComponent(roomId)}/join?invite=${encodeURIComponent(inviteToken)}`;
}
