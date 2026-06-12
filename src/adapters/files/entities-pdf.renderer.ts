import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { EntityLookupMatch } from '../../ports/entity-lookup.port';

/**
 * Renderiza un PDF con el listado completo de entidades coincidentes. Se usa
 * cuando una búsqueda devuelve >10 (no caben en la lista nativa de WhatsApp, que
 * topa en 10 filas con títulos de 24 chars). El usuario lee los nombres completos
 * + RUC y responde con el RUC o el nombre exacto para continuar.
 */
@Injectable()
export class EntitiesPdfRenderer {
  render(matches: EntityLookupMatch[]): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.font('Helvetica-Bold').fontSize(16).fillColor('#000').text('Entidades encontradas — SEACE');
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#666')
      .text(`${matches.length} coincidencias · generado ${formatDate(new Date())}`);
    doc.moveDown(0.4);
    doc
      .fontSize(9.5)
      .fillColor('#1a3c6e')
      .text(
        'Para continuar, respóndele al bot el RUC (o el nombre exacto) de la entidad que buscas.',
      );
    doc.moveDown(0.8);

    matches.forEach((m, i) => {
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#000')
        .text(`${i + 1}. ${m.nombre}`);
      const sub = [`RUC ${m.ruc}`];
      if (m.tipoDoc && m.tipoDoc.toUpperCase() !== 'RUC') sub.push(m.tipoDoc);
      doc.font('Helvetica').fontSize(9).fillColor('#555').text(sub.join('  ·  '));
      doc.moveDown(0.35);
    });

    doc.end();
    return done;
  }
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Lima',
  });
}
