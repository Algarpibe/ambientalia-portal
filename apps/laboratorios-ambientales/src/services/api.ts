import type { Laboratorio } from '../types';

// DATASET ID for Laboratorios Acreditados (Generic placeholder, to be updated if specific ID found)
// Using a common SODA API endpoint structure. 
// If specific dataset ID is known, replace 'mcpt-3dws' with it. 'mcpt-3dws' is often used for general lab data or similar examples.
// For now I will use a placeholder that we can easily swap.
const DATASET_ID = '2waz-acaa';
const BASE_URL = `https://www.datos.gov.co/resource/${DATASET_ID}.json`;

const CACHE_KEY_DATA = 'labs_cache_data';
const CACHE_KEY_TIMESTAMP = 'labs_cache_timestamp';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export const fetchLaboratorios = async (): Promise<Laboratorio[]> => {
    // Check Cache
    const cachedData = localStorage.getItem(CACHE_KEY_DATA);
    const cachedTimestamp = localStorage.getItem(CACHE_KEY_TIMESTAMP);

    if (cachedData && cachedTimestamp) {
        const age = Date.now() - parseInt(cachedTimestamp, 10);
        if (age < CACHE_DURATION) {
            console.log("Using cached Laboratories data");
            return JSON.parse(cachedData);
        }
    }

    try {
        const response = await fetch(`${BASE_URL}?$limit=5000`);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const rawData = await response.json();

        const mappedData = rawData.map((item: any) => ({
            nombre_laboratorio: item.nombre_del_laboratorio || item.laboratorio || 'Desconocido',
            departamento: item.departamento,
            municipio: item.municipio,
            direccion: item.direcci_n || '',
            telefono: item.tel_fono || '',
            correo_electronico: item.correo || '',
            vigencia_acreditacion: item.hasta || '',
            estado: item.estado_de_la_acreditaci_n || item.estado_acreditacion || 'VIGENTE',
            matriz: item.matriz,
            parametro: item.variable || item.parametro,
            metodo: item.m_todo || item.metodo,
            resolucion: item.actos_administrativos_que || '',
            fecha_resolucion: item.fecha_resolucion || ''
        }));

        // Save to cache
        try {
            localStorage.setItem(CACHE_KEY_DATA, JSON.stringify(mappedData));
            localStorage.setItem(CACHE_KEY_TIMESTAMP, Date.now().toString());
        } catch (e) {
            console.warn("Failed to save to localStorage (quota exceeded?)", e);
        }

        return mappedData;
    } catch (error) {
        console.error("Error fetching laboratorios:", error);
        // Fallback to cache if network fails, even if old
        if (cachedData) {
            console.log("Network failed, using expired cache");
            return JSON.parse(cachedData);
        }
        return [];
    }
};
