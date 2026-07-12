// Colores de las celdas/badges ABC-XYZ. Prioridad visual: A* destacado (verde
// estable, ámbar variable, rojo errático), B* intermedio, C* apagado.
export const ABC_XYZ_COLORS: Record<string, string> = {
    AX: 'bg-emerald-100 text-emerald-800',
    AY: 'bg-amber-100 text-amber-800',
    AZ: 'bg-red-100 text-red-800',
    BX: 'bg-emerald-50 text-emerald-700',
    BY: 'bg-amber-50 text-amber-700',
    BZ: 'bg-orange-100 text-orange-700',
    CX: 'bg-gray-100 text-gray-500',
    CY: 'bg-gray-100 text-gray-500',
    CZ: 'bg-gray-100 text-gray-400',
};

export const ABC_CLASSES = ['A', 'B', 'C'] as const;
export const XYZ_CLASSES = ['X', 'Y', 'Z'] as const;

// Interpretación breve por celda (para tooltips / leyenda).
export const ABC_XYZ_HINT: Record<string, string> = {
    AX: 'Caro y predecible → control fino, poco stock de seguridad',
    AY: 'Caro y variable → planificar con margen',
    AZ: 'Caro y errático → mayor riesgo, foco máximo',
    BX: 'Valor medio y predecible → reglas simples',
    BY: 'Valor medio y variable → revisión periódica',
    BZ: 'Valor medio y errático → vigilar',
    CX: 'Barato y predecible → automatizar/stock holgado',
    CY: 'Barato y variable → mínimo esfuerzo',
    CZ: 'Barato y errático → bajo pedido o descatalogar',
};
