import { ApiKeysPanel } from './api-keys-panel';

const mono = { fontFamily: 'var(--font-mono)' } as const;
const display = { fontFamily: 'var(--font-display)' } as const;

export default function ApiKeysPage() {
  return (
    <section>
      <h1
        className="text-[40px] font-bold leading-[0.96] tracking-[-0.025em] md:text-[56px]"
        style={display}
      >
        API keys
      </h1>
      <p className="mt-4 max-w-[560px] text-[13px] leading-[1.7] text-[#8a8779]" style={mono}>
        Keys authenticate requests to the Signet API as your profile. Treat one like a password:
        anyone holding it can act as you until it is revoked.
      </p>
      <div className="mt-10">
        <ApiKeysPanel />
      </div>
    </section>
  );
}
