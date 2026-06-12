import type {
  ObjetoContratacion as PrismaObjeto,
  ProcesoTab as PrismaTab,
  SubFrequency as PrismaSubFreq,
  SubStatus as PrismaSubStatus,
  NotifKind as PrismaNotifKind,
  NotifStatus as PrismaNotifStatus,
} from '@prisma/client';

export type TabName = PrismaTab;
export type ObjetoContratacion = PrismaObjeto;
export type SubFrequency = PrismaSubFreq;
export type SubStatus = PrismaSubStatus;
export type NotifKind = PrismaNotifKind;
export type NotifStatus = PrismaNotifStatus;

export interface SearchFilters {
  entityRuc?: string;
  /**
   * Nombre exacto de la entidad. Para ACF: los anuncios guardan `entityNombre`
   * pero NO el RUC (SEACE no lo expone en la lista), así que el filtro por
   * entidad se hace por nombre. El nombre viene de la tabla `entities` (resuelto
   * por el flujo), garantizando coincidencia con el nombre raspado del anuncio.
   */
  entityNombre?: string;
  objeto?: ObjetoContratacion;
  tipoSeleccionIds?: number[];
  anioConvocatoria?: number;
  departamento?: string;
  keyword?: string;
  valorMin?: number;
  valorMax?: number;
}

export interface ProcessRow {
  tab: TabName;
  nomenclatura: string | null;
  entityRuc: string | null;
  entityNombre: string;
  fechaPublicacion: Date | null;
  tipoSeleccion: string | null;
  tipoSeleccionId: number | null;
  objeto: ObjetoContratacion | null;
  descripcion: string | null;
  alcance: string | null;
  cantidad: string | null;
  plazoDias: number | null;
  fechaAproxConv: Date | null;
  codigoSnip: string | null;
  codigoCui: string | null;
  valorReferencial: string | null;
  moneda: string | null;
  versionSeace: number | null;
  nidProceso: string | null;
  nidConvocatoria: string | null;
  urlRepositorio: string | null;
  contentHash: string;
  raw: unknown;
}

export interface Duration {
  ms: number;
}

export const minutes = (n: number): Duration => ({ ms: n * 60_000 });
export const hours = (n: number): Duration => ({ ms: n * 3_600_000 });
export const days = (n: number): Duration => ({ ms: n * 86_400_000 });
