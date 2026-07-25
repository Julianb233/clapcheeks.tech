export type ApprovalFingerprintInput = {
  recipient: string;
  channel: string;
  exactBody: string;
  sourcePacketId: string;
};

export async function approvalFingerprint({
  recipient,
  channel,
  exactBody,
  sourcePacketId,
}: ApprovalFingerprintInput): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("SHA-256 is unavailable; exact approval must fail closed");
  }
  const canonical = [
    recipient.trim(),
    channel.trim().toLowerCase(),
    exactBody,
    sourcePacketId,
  ].join("\x1f");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
