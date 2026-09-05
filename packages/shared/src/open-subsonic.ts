export type OpenSubsonicAccountKey = {
  id: string;
  name: string;
  hint: string;
  createdAt: string;
};

export type OpenSubsonicKeysResponse = {
  keys: OpenSubsonicAccountKey[];
};

export type OpenSubsonicKeyCreateResponse = {
  key: OpenSubsonicAccountKey;
  token: string;
};
