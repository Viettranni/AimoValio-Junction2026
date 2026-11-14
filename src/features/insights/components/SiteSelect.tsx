export function SiteSelect({ sites, value, onChange }: { sites: Array<{ id: string; name: string }>; value: string; onChange: (id: string) => void }) {
  return (
    <select aria-label="Restaurant" value={value} onChange={(e) => onChange(e.target.value)} disabled={!sites.length}>
      <option value="">All restaurants</option>
      {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}
