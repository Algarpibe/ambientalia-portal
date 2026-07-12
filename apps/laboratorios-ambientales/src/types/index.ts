export type Laboratorio = {
    nombre_laboratorio: string;
    departamento: string;
    municipio: string;
    direccion: string;
    telefono: string;
    correo_electronico: string;
    vigencia_acreditacion: string;
    estado: string;
    matriz: string;
    parametro: string;
    metodo: string;
    resolucion: string;
    fecha_resolucion: string;
}

export type FilterState = {
    nombre: string;
    estado: string;
    matriz: string;
    componente: string;
    actividad: string;
    variable: string;
    metodo: string;
}

export interface AIResponse {
    text: string;
    data?: any;
}
