export const USERNAME_MAX_CHARACTERS = 120;

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;

export type NormalizedUsername = {
  username: string;
  usernameNormalized: string;
};

function characterLength(value: string) {
  return Array.from(value).length;
}

export function normalizeUsername(value: string): NormalizedUsername | null {
  const username = value.trim().normalize('NFKC');
  if (!username || CONTROL_CHARACTERS.test(username)) return null;
  if (characterLength(username) > USERNAME_MAX_CHARACTERS) return null;

  const usernameNormalized = username.toLowerCase();
  if (!usernameNormalized || characterLength(usernameNormalized) > USERNAME_MAX_CHARACTERS) return null;

  return { username, usernameNormalized };
}
