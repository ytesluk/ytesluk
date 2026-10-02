import { decrypt, encrypt } from "@wco/config";
import { customerHash, maskPhone, normalizePhone } from "@wco/domain";

/**
 * Personal-data vault (spec §23, §24): customer phones are stored encrypted (AES-256-GCM), looked up by
 * an HMAC hash (customerHash) and displayed masked. Access tokens use the same envelope.
 */
export class Vault {
  constructor(
    private readonly key: Buffer,
    private readonly pepper: string,
  ) {}

  phone(input: string, defaultCallingCode?: string): { e164: string; hash: string; masked: string; encrypted: string } {
    const e164 = normalizePhone(input, defaultCallingCode);
    return { e164, hash: customerHash(e164, this.pepper), masked: maskPhone(e164), encrypted: encrypt(e164, this.key) };
  }

  hashPhone(input: string): string {
    return customerHash(normalizePhone(input), this.pepper);
  }

  decryptPhone(encrypted: string | null | undefined): string | null {
    return encrypted ? decrypt(encrypted, this.key) : null;
  }

  encryptSecret(secret: string): string {
    return encrypt(secret, this.key);
  }

  decryptSecret(encrypted: string): string {
    return decrypt(encrypted, this.key);
  }
}
