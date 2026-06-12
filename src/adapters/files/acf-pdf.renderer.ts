import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { StoredProcess } from '../../ports/persistence/processes.repo.port';

/**
 * Renderiza un PDF con TODOS los anuncios de contratación futura (ACF) de una
 * búsqueda, **agrupados por entidad**. Se usa cuando hay >5 resultados (en el
 * chat solo van 5 tarjetas). pdfkit es JS puro (sin navegador), corre en el
 * container del API y del worker.
 *
 * Estructura: cabecera → índice por entidad (con conteo) → una sección por
 * entidad con sus anuncios (fecha, objeto, tipo selección, conv. aprox., plazo,
 * descripción). Las entidades se ordenan por cantidad de anuncios (desc) y los
 * anuncios de cada una por fecha de publicación (desc).
 */
@Injectable()
export class AcfPdfRenderer {
  render(processes: StoredProcess[]): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const groups = groupByEntity(processes);

    // Cabecera
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor('#000')
      .text('Anuncios de Contratación Futura — SEACE');
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#666')
      .text(
        `${processes.length} anuncios · ${groups.length} entidades · generado ${formatDate(new Date())}`,
      );
    doc.moveDown(1);

    // Índice por entidad
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text('Índice por entidad');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    groups.forEach(([name, list], i) => {
      doc.text(`${i + 1}. ${name}  (${list.length})`);
    });

    // Secciones por entidad
    groups.forEach(([name, list], i) => {
      doc.moveDown(i === 0 ? 1 : 0.7);
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor('#1a3c6e')
        .text(`${i + 1}. ${name}  (${list.length})`);
      doc.moveDown(0.2);
      list.forEach((p, j) => this.renderAnuncio(doc, p, j + 1));
    });

    doc.end();
    return done;
  }

  private renderAnuncio(doc: PDFKit.PDFDocument, p: StoredProcess, n: number): void {
    const acf = p.acf;
    doc.moveDown(0.35);

    const head: string[] = [];
    if (acf?.tipoSeleccion) head.push(acf.tipoSeleccion);
    if (p.objeto) head.push(capitalize(p.objeto.replace('_', ' ')));
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor('#000')
      .text(`${n}. ${head.join(' · ') || 'Anuncio'}`);

    const meta: string[] = [];
    if (p.fechaPublicacion) meta.push(`Pub: ${formatDate(p.fechaPublicacion)}`);
    if (acf?.fechaAproxConv) meta.push(`Conv. aprox.: ${formatDate(acf.fechaAproxConv, 'UTC')}`); // DATE → UTC
    if (acf?.plazoDias != null) meta.push(`Plazo: ${acf.plazoDias} días`);
    const cui = extractCui(acf?.alcance);
    if (cui) meta.push(`CUI: ${cui}`);
    if (acf?.cantidad != null) meta.push(`Cantidad: ${acf.cantidad}`);
    if (meta.length) doc.font('Helvetica').fontSize(8.5).fillColor('#444').text(meta.join('  ·  '));

    if (p.descripcion)
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#333').text(p.descripcion);
    // Alcance completo: el detalle rico (proyecto + ubicación + CUI) que la
    // tarjeta de WhatsApp no muestra; en el PDF sí cabe.
    if (acf?.alcance) doc.font('Helvetica').fontSize(8).fillColor('#666').text(acf.alcance);
  }
}

/** Agrupa por nombre de entidad; ordena entidades por #anuncios desc y anuncios por fecha desc. */
function groupByEntity(processes: StoredProcess[]): [string, StoredProcess[]][] {
  const byEntity = new Map<string, StoredProcess[]>();
  for (const p of processes) {
    const key = p.entityNombre || '(Sin entidad)';
    const bucket = byEntity.get(key);
    if (bucket) bucket.push(p);
    else byEntity.set(key, [p]);
  }
  const groups = [...byEntity.entries()];
  for (const [, list] of groups) {
    list.sort(
      (a, b) => (b.fechaPublicacion?.getTime() ?? 0) - (a.fechaPublicacion?.getTime() ?? 0),
    );
  }
  groups.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  return groups;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Extrae el código CUI del texto de alcance (ej. "… CON CUI: 2525669"). */
function extractCui(alcance: string | null | undefined): string | null {
  if (!alcance) return null;
  return /\bCUI[:\s]*(\d{3,})/i.exec(alcance)?.[1] ?? null;
}

function formatDate(d: Date, timeZone = 'America/Lima'): string {
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone });
}
