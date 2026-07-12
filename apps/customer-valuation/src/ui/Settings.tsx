import { useState } from 'react';
import type { ScoringConfig, ExtendedScoringConfig } from '../types';

interface SettingsProps {
    config: ScoringConfig;
    extendedConfig: ExtendedScoringConfig;
    onSave: (config: ScoringConfig, extendedConfig: ExtendedScoringConfig) => boolean;
}

// Descriptions for each metric
const METRIC_DESCRIPTIONS: Record<string, Record<string, string>> = {
    'Score de Valor (V)': {
        'gmPct': 'Margen Bruto % - Porcentaje de rentabilidad calculado como (Ventas - Costo) / Ventas. Mayor valor indica mejor rentabilidad relativa.',
        'gmAbs': 'Margen Bruto $ - Ganancia absoluta en dinero. Mide la contribución total del cliente a las ganancias de la empresa.',
        'mixMarginIndex': 'Índice de Mix de Margen - Porcentaje de ventas en productos de alto margen. Mayor valor indica mejor mix de productos.'
    },
    'Score de Pagos (P)': {
        'lateValueRate': 'Tasa de Mora por Valor - Porcentaje del valor facturado que se paga tarde. Menor valor indica mejor comportamiento de pago.',
        'severity': 'Severidad - Promedio ponderado de días de mora por valor facturado. Mide la gravedad del retraso en pagos.',
        'avgDpd': 'DPD Promedio - Días promedio pasados la fecha de vencimiento. Indicador general de comportamiento de pago.',
        'volatility': 'Volatilidad - Variabilidad en el comportamiento de pago. Menor volatilidad indica mayor consistencia y predictibilidad.'
    },
    'Score de Ventas (S) [Histórico]': {
        'rev': 'Volumen de Ventas - Ingresos totales de los últimos 3 años. Mide el tamaño del cliente.',
        'growth': 'Crecimiento - Tasa de crecimiento YoY y CAGR. Indica la tendencia del cliente (creciendo o decreciendo).',
        'stability': 'Estabilidad - Inversamente proporcional al coeficiente de variación. Mayor estabilidad indica menor riesgo.',
        'loyalty': 'Lealtad - Número de años activos. Mide la longevidad y compromiso del cliente con la empresa.'
    }
};

interface ValidationError {
    section: string;
    sum: number;
}

export function Settings({
    config,
    extendedConfig,
    onSave
}: SettingsProps) {
    // Local pending state
    const [pendingConfig, setPendingConfig] = useState<ScoringConfig>(config);
    const [pendingExtendedConfig, setPendingExtendedConfig] = useState<ExtendedScoringConfig>(extendedConfig);

    // Check if any changes have been made
    const hasChanges = JSON.stringify(config) !== JSON.stringify(pendingConfig) ||
        JSON.stringify(extendedConfig) !== JSON.stringify(pendingExtendedConfig);

    // Validation function
    const validateWeights = (): ValidationError[] => {
        const errors: ValidationError[] = [];
        const normalize = (sum: number) => Math.round(sum * 100) / 100;
        const exceeds = (sum: number) => normalize(sum) > 100.01;

        // Validate Value weights
        const valueSum = Object.values(pendingConfig.valueWeights).reduce((a, b) => a + b, 0) * 100;
        if (exceeds(valueSum)) {
            errors.push({ section: 'Score de Valor (V)', sum: normalize(valueSum) });
        }

        // Validate Payment weights
        const paymentSum = Object.values(pendingConfig.paymentWeights).reduce((a, b) => a + b, 0) * 100;
        if (exceeds(paymentSum)) {
            errors.push({ section: 'Score de Pagos (P)', sum: normalize(paymentSum) });
        }

        // Validate Sales weights
        const salesSum = Object.values(pendingExtendedConfig.salesWeights).reduce((a, b) => a + b, 0) * 100;
        if (exceeds(salesSum)) {
            errors.push({ section: 'Score de Ventas (S)', sum: normalize(salesSum) });
        }

        // Validate Standard Total weights
        const totalStandardSum = (pendingConfig.totalScoreValueWeight + pendingConfig.totalScorePaymentWeight) * 100;
        if (exceeds(totalStandardSum)) {
            errors.push({ section: 'Score Total Estándar', sum: normalize(totalStandardSum) });
        }

        // Validate Extended Total weights
        const totalExtendedSum = (pendingExtendedConfig.totalScoreWeightsExtended.value +
            pendingExtendedConfig.totalScoreWeightsExtended.payment +
            pendingExtendedConfig.totalScoreWeightsExtended.sales) * 100;
        if (exceeds(totalExtendedSum)) {
            errors.push({ section: 'Score Total Extendido', sum: normalize(totalExtendedSum) });
        }

        return errors;
    };

    const validationErrors = validateWeights();
    const isValid = validationErrors.length === 0;
    const canSave = hasChanges && isValid;

    const handleValueWeightChange = (key: string, val: number) => {
        const newWeights = { ...pendingConfig.valueWeights, [key]: val / 100 };
        setPendingConfig({ ...pendingConfig, valueWeights: newWeights });
        setPendingExtendedConfig({ ...pendingExtendedConfig, valueWeights: newWeights });
    };

    const handlePaymentWeightChange = (key: string, val: number) => {
        const newWeights = { ...pendingConfig.paymentWeights, [key]: val / 100 };
        setPendingConfig({ ...pendingConfig, paymentWeights: newWeights });
        setPendingExtendedConfig({ ...pendingExtendedConfig, paymentWeights: newWeights });
    };

    const handleSalesWeightChange = (key: string, val: number) => {
        const newWeights = { ...pendingExtendedConfig.salesWeights, [key]: val / 100 };
        setPendingExtendedConfig({ ...pendingExtendedConfig, salesWeights: newWeights });
    };

    const handleSave = () => {
        if (canSave) {
            const success = onSave(pendingConfig, pendingExtendedConfig);
            if (!success) {
                alert('Error al guardar la configuración');
            }
        }
    };

    const handleReset = () => {
        setPendingConfig(config);
        setPendingExtendedConfig(extendedConfig);
    };

    return (
        <div className="card">
            <div className="card__header">
                <h3>⚙️ Ajustes de Configuración</h3>
            </div>

            <div style={{ marginTop: '24px' }}>
                <h4 style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', marginBottom: '16px' }}>
                    Ponderación de Scores (Pesos)
                </h4>

                <div className="detail__grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
                    <SettingSection
                        title="Score de Valor (V)"
                        weights={pendingConfig.valueWeights}
                        onChange={handleValueWeightChange}
                        descriptions={METRIC_DESCRIPTIONS['Score de Valor (V)']}
                    />
                    <SettingSection
                        title="Score de Pagos (P)"
                        weights={pendingConfig.paymentWeights}
                        onChange={handlePaymentWeightChange}
                        descriptions={METRIC_DESCRIPTIONS['Score de Pagos (P)']}
                    />
                    <SettingSection
                        title="Score de Ventas (S) [Histórico]"
                        weights={pendingExtendedConfig.salesWeights}
                        onChange={handleSalesWeightChange}
                        descriptions={METRIC_DESCRIPTIONS['Score de Ventas (S) [Histórico]']}
                    />
                    
                    {/* Configuración de Ventas Históricas */}
                    <div style={{ marginTop: '24px', padding: '16px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px' }}>
                        <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 600 }}>Configuración de Ventas Históricas</h4>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                            <input
                                type="checkbox"
                                checked={pendingConfig.includeCurrentYearInHistory}
                                onChange={(e) => {
                                    const includeCurrentYearInHistory = e.target.checked;
                                    setPendingConfig({ ...pendingConfig, includeCurrentYearInHistory });
                                    setPendingExtendedConfig({ ...pendingExtendedConfig, includeCurrentYearInHistory });
                                }}
                            />
                            <label>Incluir año actual (2026) en cálculos de ventas históricas</label>
                            <span 
                                style={{ 
                                    cursor: 'help', 
                                    fontSize: '14px', 
                                    color: 'var(--accent)',
                                    fontWeight: 600,
                                    marginLeft: '4px'
                                }}
                                title="Cuando está marcado, incluye datos parciales del año en curso (2026) en métricas de 3 y 5 años. Útil si el año actual tiene datos representativos. Cuando está desmarcado, solo considera años completos (2025 hacia atrás), recomendado al inicio del año o si los datos actuales son incompletos."
                            >
                                ⓘ
                            </span>
                        </div>

                        {/* Scoring Mode */}
                        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--muted-lighter)' }}>
                            <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 600 }}>Modo de Scoring</h4>
                            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', fontSize: '13px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="radio"
                                        id="scoring-standard"
                                        name="scoringMode"
                                        checked={pendingConfig.scoringMode === 'standard'}
                                        onChange={() => {
                                            setPendingConfig({ ...pendingConfig, scoringMode: 'standard' });
                                            setPendingExtendedConfig({ ...pendingExtendedConfig, scoringMode: 'standard' });
                                        }}
                                    />
                                    <label htmlFor="scoring-standard" style={{ margin: 0, cursor: 'pointer' }}>
                                        Score Total Estándar (V + P)
                                    </label>
                                    <span 
                                        style={{ 
                                            cursor: 'help', 
                                            fontSize: '14px', 
                                            color: 'var(--accent)',
                                            fontWeight: 600
                                        }}
                                        title="Usa solo Valor (V) y Pagos (P) para la segmentación y análisis de clientes. Más simple y enfocado en rentabilidad e historial de pagos."
                                    >
                                        ⓘ
                                    </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="radio"
                                        id="scoring-extended"
                                        name="scoringMode"
                                        checked={pendingConfig.scoringMode === 'extended'}
                                        onChange={() => {
                                            setPendingConfig({ ...pendingConfig, scoringMode: 'extended' });
                                            setPendingExtendedConfig({ ...pendingExtendedConfig, scoringMode: 'extended' });
                                        }}
                                    />
                                    <label htmlFor="scoring-extended" style={{ margin: 0, cursor: 'pointer' }}>
                                        Score Total Extendido (V + P + S)
                                    </label>
                                    <span 
                                        style={{ 
                                            cursor: 'help', 
                                            fontSize: '14px', 
                                            color: 'var(--accent)',
                                            fontWeight: 600
                                        }}
                                        title="Incluye Tracción Histórica (S) además de Valor (V) y Pagos (P). Análisis más completo que considera el crecimiento y trayectoria del cliente."
                                    >
                                        ⓘ
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div style={{ marginTop: '24px' }}>
                    {/* Segment Thresholds */}
                    <div style={{ gridColumn: '1 / -1', marginTop: '20px' }}>
                        <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600 }}>Umbrales de Segmentación</h4>
                        <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--muted)', position: 'relative' }}>
                            <input
                                type="checkbox"
                                checked={pendingConfig.useGatingForSegmentation}
                                onChange={(e) => {
                                    const useGatingForSegmentation = e.target.checked;
                                    setPendingConfig({ ...pendingConfig, useGatingForSegmentation });
                                    setPendingExtendedConfig({ ...pendingExtendedConfig, useGatingForSegmentation });
                                }}
                            />
                            <span>Aplicar candados de gating al asignar etiqueta de segmento</span>
                            <span 
                                style={{ 
                                    cursor: 'help', 
                                    fontSize: '14px', 
                                    color: 'var(--accent)',
                                    fontWeight: 600,
                                    marginLeft: '4px'
                                }}
                                title="Cuando está marcado, los candados de mora (bloqueado, restringido) fuerzan la segmentación aunque los scores V y P califiquen para mejores categorías. Ejemplo: un cliente con V=90, P=85 pero con LateValueRate>30% será forzado a RESTRINGIDO. Si desmarcar, solo se usan los scores V y P para determinar el segmento."
                            >
                                ⓘ
                            </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                            {/* Premium */}
                            <div className="stat">
                                <h5 style={{ margin: '0 0 12px 0', fontSize: '15px', color: '#10b981' }}>Premium</h5>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                                        <span>Score V mínimo:</span>
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={pendingConfig.segmentThresholds.premiumMinValue}
                                            onChange={(e) => {
                                                const segmentThresholds = { ...pendingConfig.segmentThresholds, premiumMinValue: Number(e.target.value) };
                                                setPendingConfig({ ...pendingConfig, segmentThresholds });
                                                setPendingExtendedConfig({ ...pendingExtendedConfig, segmentThresholds });
                                            }}
                                            style={{ width: '60px', padding: '4px', textAlign: 'right' }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                                        <span>Score P mínimo:</span>
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={pendingConfig.segmentThresholds.premiumMinPayment}
                                            onChange={(e) => {
                                                const segmentThresholds = { ...pendingConfig.segmentThresholds, premiumMinPayment: Number(e.target.value) };
                                                setPendingConfig({ ...pendingConfig, segmentThresholds });
                                                setPendingExtendedConfig({ ...pendingExtendedConfig, segmentThresholds });
                                            }}
                                            style={{ width: '60px', padding: '4px', textAlign: 'right' }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Valioso Condicionado */}
                            <div className="stat">
                                <h5 style={{ margin: '0 0 12px 0', fontSize: '15px', color: '#f59e0b' }}>Valioso Condicionado</h5>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                                        <span>Score V mínimo:</span>
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={pendingConfig.segmentThresholds.condicionadoMinValue}
                                            onChange={(e) => {
                                                const segmentThresholds = { ...pendingConfig.segmentThresholds, condicionadoMinValue: Number(e.target.value) };
                                                setPendingConfig({ ...pendingConfig, segmentThresholds });
                                                setPendingExtendedConfig({ ...pendingExtendedConfig, segmentThresholds });
                                            }}
                                            style={{ width: '60px', padding: '4px', textAlign: 'right' }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                                        <span>Score P mínimo:</span>
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={pendingConfig.segmentThresholds.condicionadoMinPayment}
                                            onChange={(e) => {
                                                const segmentThresholds = { ...pendingConfig.segmentThresholds, condicionadoMinPayment: Number(e.target.value) };
                                                setPendingConfig({ ...pendingConfig, segmentThresholds });
                                                setPendingExtendedConfig({ ...pendingExtendedConfig, segmentThresholds });
                                            }}
                                            style={{ width: '60px', padding: '4px', textAlign: 'right' }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Estándar */}
                            <div className="stat">
                                <h5 style={{ margin: '0 0 12px 0', fontSize: '15px', color: '#3b82f6' }}>Estándar</h5>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                                        <span>Score V mínimo:</span>
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={pendingConfig.segmentThresholds.estandarMinValue}
                                            onChange={(e) => {
                                                const segmentThresholds = { ...pendingConfig.segmentThresholds, estandarMinValue: Number(e.target.value) };
                                                setPendingConfig({ ...pendingConfig, segmentThresholds });
                                                setPendingExtendedConfig({ ...pendingExtendedConfig, segmentThresholds });
                                            }}
                                            style={{ width: '60px', padding: '4px', textAlign: 'right' }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                                        <span>Score P mínimo:</span>
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={pendingConfig.segmentThresholds.estandarMinPayment}
                                            onChange={(e) => {
                                                const segmentThresholds = { ...pendingConfig.segmentThresholds, estandarMinPayment: Number(e.target.value) };
                                                setPendingConfig({ ...pendingConfig, segmentThresholds });
                                                setPendingExtendedConfig({ ...pendingExtendedConfig, segmentThresholds });
                                            }}
                                            style={{ width: '60px', padding: '4px', textAlign: 'right' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Total Score Weights */}
                    <div style={{ gridColumn: '1 / -1', marginTop: '20px' }}>
                        <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600 }}>Pesos del Score Total</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                            {/* Standard Config (V + P) */}
                            <div className="stat">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                                    <h5 style={{ margin: 0, fontSize: '15px' }}>Score Total Estándar (V + P)</h5>
                                    <span 
                                        style={{ 
                                            cursor: 'help', 
                                            fontSize: '14px', 
                                            color: 'var(--accent)',
                                            fontWeight: 600,
                                            flexShrink: 0
                                        }}
                                        title="Configuración estándar que combina Valor (V) y Pagos (P). Define cómo se pondera cada componente en el cálculo del Score Total para la segmentación de clientes."
                                    >
                                        ⓘ
                                    </span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                                        <span>Peso Valor (V)</span>
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={Math.round(pendingConfig.totalScoreValueWeight * 100)}
                                            onChange={(e) => setPendingConfig({ ...pendingConfig, totalScoreValueWeight: Number(e.target.value) / 100 })}
                                            style={{ width: '60px', padding: '4px', textAlign: 'right' }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                                        <span>Peso Pagos (P)</span>
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={Math.round(pendingConfig.totalScorePaymentWeight * 100)}
                                            onChange={(e) => setPendingConfig({ ...pendingConfig, totalScorePaymentWeight: Number(e.target.value) / 100 })}
                                            style={{ width: '60px', padding: '4px', textAlign: 'right' }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Extended Config (V + P + S) */}
                            <div className="stat">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                                    <h5 style={{ margin: 0, fontSize: '15px' }}>Score Total Extendido (V + P + S)</h5>
                                    <span 
                                        style={{ 
                                            cursor: 'help', 
                                            fontSize: '14px', 
                                            color: 'var(--accent)',
                                            fontWeight: 600,
                                            flexShrink: 0
                                        }}
                                        title="Configuración extendida que añade Tracción Histórica (S) además de Valor (V) y Pagos (P). Proporciona un análisis más completo incorporando el crecimiento histórico del cliente."
                                    >
                                        ⓘ
                                    </span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                                        <span>Peso Valor (V)</span>
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={Math.round(pendingExtendedConfig.totalScoreWeightsExtended.value * 100)}
                                            onChange={(e) => setPendingExtendedConfig({
                                                ...pendingExtendedConfig,
                                                totalScoreWeightsExtended: { ...pendingExtendedConfig.totalScoreWeightsExtended, value: Number(e.target.value) / 100 }
                                            })}
                                            style={{ width: '60px', padding: '4px', textAlign: 'right' }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                                        <span>Peso Pagos (P)</span>
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={Math.round(pendingExtendedConfig.totalScoreWeightsExtended.payment * 100)}
                                            onChange={(e) => setPendingExtendedConfig({
                                                ...pendingExtendedConfig,
                                                totalScoreWeightsExtended: { ...pendingExtendedConfig.totalScoreWeightsExtended, payment: Number(e.target.value) / 100 }
                                            })}
                                            style={{ width: '60px', padding: '4px', textAlign: 'right' }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                                        <span>Peso Ventas (S)</span>
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={Math.round(pendingExtendedConfig.totalScoreWeightsExtended.sales * 100)}
                                            onChange={(e) => setPendingExtendedConfig({
                                                ...pendingExtendedConfig,
                                                totalScoreWeightsExtended: { ...pendingExtendedConfig.totalScoreWeightsExtended, sales: Number(e.target.value) / 100 }
                                            })}
                                            style={{ width: '60px', padding: '4px', textAlign: 'right' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Validation Errors */}
            {validationErrors.length > 0 && (
                <div style={{
                    marginTop: '24px',
                    padding: '12px',
                    background: 'rgba(249, 115, 22, 0.1)',
                    border: '1px solid rgba(249, 115, 22, 0.3)',
                    borderRadius: '8px',
                    color: '#92400e'
                }}>
                    <div style={{ fontWeight: 600, marginBottom: '8px' }}>⚠️ Errores de Validación:</div>
                    {validationErrors.map((error, idx) => (
                        <div key={idx} style={{ fontSize: '13px', marginTop: '4px' }}>
                            • <strong>{error.section}</strong>: suma = {error.sum}% (máximo 100%)
                        </div>
                    ))}
                </div>
            )}

            {/* Save/Reset Buttons */}
            <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                    onClick={handleReset}
                    disabled={!hasChanges}
                    style={{
                        padding: '10px 20px',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                        background: 'white',
                        color: 'var(--text)',
                        fontSize: '14px',
                        fontWeight: 500,
                        cursor: hasChanges ? 'pointer' : 'not-allowed',
                        opacity: hasChanges ? 1 : 0.5,
                        transition: 'all 0.2s'
                    }}
                >
                    Descartar Cambios
                </button>
                <button
                    onClick={handleSave}
                    disabled={!canSave}
                    style={{
                        padding: '10px 24px',
                        borderRadius: '8px',
                        border: 'none',
                        background: canSave ? 'linear-gradient(135deg, var(--accent), #6d28d9)' : '#e2e8f0',
                        color: canSave ? 'white' : 'var(--muted)',
                        fontSize: '14px',
                        fontWeight: 700,
                        cursor: canSave ? 'pointer' : 'not-allowed',
                        transition: 'all 0.2s',
                        boxShadow: canSave ? '0 2px 8px rgba(124, 58, 237, 0.2)' : 'none'
                    }}
                >
                    💾 Guardar Configuración
                </button>
            </div>
        </div>
            );
}

function SettingSection({
    title,
    weights,
    onChange,
    descriptions
}: {
    title: string;
    weights: object;
    onChange: (key: string, val: number) => void;
    descriptions: Record<string, string>;
}) {
    const [showTooltip, setShowTooltip] = useState(false);

    return (
        <div className="stat" style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <h5 style={{ margin: '0', fontSize: '15px' }}>{title}</h5>
                <button
                    onClick={() => setShowTooltip(!showTooltip)}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '16px',
                        padding: '4px',
                        borderRadius: '50%',
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: showTooltip ? 'var(--accent)' : 'var(--muted)',
                        transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(124, 58, 237, 0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    title="Ver descripción de indicadores"
                >
                    ℹ️
                </button>
            </div>

            {showTooltip && (
                <div
                    className="settings-tooltip"
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: '0',
                        right: '0',
                        marginTop: '8px',
                        background: 'white',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        padding: '12px',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                        zIndex: 1000,
                        fontSize: '12px',
                        lineHeight: '1.5'
                    }}
                >
                    <div style={{ marginBottom: '8px', fontWeight: 600, color: 'var(--accent)' }}>
                        Descripción de indicadores:
                    </div>
                    {Object.entries(weights).map(([key]) => {
                        const label = key.replace(/([A-Z])/g, ' $1').trim();
                        const capitalizedLabel = label.charAt(0).toUpperCase() + label.slice(1);
                        return (
                            <div key={key} style={{ marginBottom: '8px' }}>
                                <strong style={{ color: 'var(--text)' }}>{capitalizedLabel}:</strong>
                                <div style={{ color: 'var(--muted)', marginTop: '2px' }}>
                                    {descriptions[key] || 'Sin descripción disponible'}
                                </div>
                            </div>
                        );
                    })}
                    <button
                        onClick={() => setShowTooltip(false)}
                        style={{
                            marginTop: '8px',
                            background: 'var(--accent)',
                            color: 'white',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            cursor: 'pointer',
                            width: '100%'
                        }}
                    >
                        Cerrar
                    </button>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {Object.entries(weights).map(([key, val]) => (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                        <span style={{ textTransform: 'capitalize', color: 'var(--muted)' }}>
                            {key.replace(/([A-Z])/g, ' $1').trim()}
                        </span>
                        <input
                            type="number"
                            min="0"
                            max="100"
                            value={Math.round(Number(val) * 100)}
                            onChange={(e) => onChange(key, Number(e.target.value))}
                            style={{ width: '60px', padding: '4px', textAlign: 'right' }}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
