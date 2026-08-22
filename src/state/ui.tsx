import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type Plan = 'free' | 'premium';
export interface Units { area: string; volume: string; weight: string }
export interface Account { name: string; email: string; id: string }

interface UIState {
  plan: Plan;
  setPlan: (p: Plan) => void;
  units: Units;
  setUnits: (u: Units) => void;
  language: string;
  setLanguage: (l: string) => void;
  saveData: string;
  setSaveData: (s: string) => void;
  account: Account | null;
  setAccount: (a: Account | null) => void;
}

const UIContext = createContext<UIState | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<Plan>('free');
  const [units, setUnits] = useState<Units>({ area: 'sqm', volume: 'cum', weight: 'kg' });
  const [language, setLanguage] = useState('english');
  const [saveData, setSaveData] = useState('7days');
  // Login isn't wired to a backend yet — assume a signed-in user so the app shows its
  // authenticated state. Logout clears this; the Profile page can sign back in.
  const [account, setAccount] = useState<Account | null>({
    name: 'Ram Kumar',
    email: 'ramkumar@test.com',
    id: 'QSS-8F3K2A',
  });

  const value = useMemo<UIState>(
    () => ({ plan, setPlan, units, setUnits, language, setLanguage, saveData, setSaveData, account, setAccount }),
    [plan, units, language, saveData, account],
  );
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIState {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}

/** Display-unit conversion (SI base → chosen unit), shared by pages that show quantities. */
const CONV: Record<string, Record<string, [number, string]>> = {
  m2: { sqm: [1, 'm²'], sqft: [10.7639, 'sqft'] },
  m3: { cum: [1, 'm³'], cft: [35.3147, 'cft'] },
  kg: { kg: [1, 'kg'], mt: [0.001, 'MT'] },
};
export function displayQuantity(base: number, ruleUnit: 'm2' | 'm3' | 'kg', units: Units): { v: number; u: string } {
  const pick = ruleUnit === 'm2' ? units.area : ruleUnit === 'm3' ? units.volume : units.weight;
  const [f, u] = CONV[ruleUnit][pick] ?? [1, ruleUnit];
  return { v: base * f, u };
}
