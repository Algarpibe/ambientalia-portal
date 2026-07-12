
type Tab = 'dashboard' | 'settings';

interface SidebarProps {
    activeTab: Tab;
    onTabChange: (tab: Tab) => void;
    onLogout?: () => void;
}

export function Sidebar({ activeTab, onTabChange, onLogout }: SidebarProps) {
    return (
        <aside style={{
            width: '240px',
            backgroundColor: 'var(--card)',
            borderRight: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            flexShrink: 0
        }}>
            <div style={{ padding: '24px', borderBottom: '1px solid #e2e8f0' }}>
                <h2 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    🚀 <span style={{ fontWeight: 800, color: 'var(--accent)' }}>Ambientalia</span>
                </h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--muted)' }}>
                    Valoración de Clientes
                </p>
            </div>

            <nav style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <SidebarItem
                    label="Dashboard de Análisis"
                    icon="📊"
                    active={activeTab === 'dashboard'}
                    onClick={() => onTabChange('dashboard')}
                />
                <SidebarItem
                    label="Ajustes"
                    icon="⚙️"
                    active={activeTab === 'settings'}
                    onClick={() => onTabChange('settings')}
                />
            </nav>

            <div style={{ padding: '16px', borderTop: '1px solid #e2e8f0' }}>
                {onLogout && (
                    <button
                        onClick={onLogout}
                        className="btn btn--secondary"
                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '13px' }}
                    >
                        ⬅ Volver a Carga
                    </button>
                )}
            </div>
        </aside>
    );
}

function SidebarItem({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                width: '100%',
                padding: '12px 16px',
                background: active ? 'rgba(124, 58, 237, 0.08)' : 'transparent',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                color: active ? 'var(--accent)' : 'var(--text)',
                fontWeight: active ? 600 : 500,
                textAlign: 'left',
                transition: 'all 0.2s'
            }}
        >
            <span style={{ fontSize: '18px' }}>{icon}</span>
            {label}
        </button>
    );
}
