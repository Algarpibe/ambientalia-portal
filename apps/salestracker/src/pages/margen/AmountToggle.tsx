export type AmountMode = 'money' | 'pct';

export default function AmountToggle({ value, onChange }: { value: AmountMode; onChange: (m: AmountMode) => void }) {
  return (
    <div className="st-seg flat">
      <button type="button" aria-pressed={value === 'money'} onClick={() => onChange('money')}>$</button>
      <button type="button" aria-pressed={value === 'pct'} onClick={() => onChange('pct')}>%</button>
    </div>
  );
}
