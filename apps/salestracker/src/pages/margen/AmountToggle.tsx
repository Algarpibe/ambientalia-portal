export type AmountMode = 'money' | 'pct';

export default function AmountToggle({ value, onChange }: { value: AmountMode; onChange: (m: AmountMode) => void }) {
  const btn = (m: AmountMode) =>
    `px-2.5 py-1 text-xs font-medium rounded-md ${value === m ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`;
  return (
    <div className="inline-flex rounded-lg border p-0.5">
      <button type="button" className={btn('money')} onClick={() => onChange('money')}>$</button>
      <button type="button" className={btn('pct')} onClick={() => onChange('pct')}>%</button>
    </div>
  );
}
