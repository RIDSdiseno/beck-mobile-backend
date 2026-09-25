import type { Request, Response } from 'express';
const mockUpdate = jest.fn();
const mockPdf = jest.fn();
jest.mock('../config/prisma', () => ({ prisma: {
  usuarios_obras: { findMany: jest.fn(async () => [{ obra_id: 'obra' }]) },
  usuarios: { findUnique: jest.fn(async () => ({ nombre: 'Nombre al firmar' })) },
  registros_terreno: {
    findUnique: jest.fn(async () => ({ id: 'registro', obra_id: 'obra', estado: 'validado', validado_cliente: false })),
    updateMany: (...args: unknown[]) => mockUpdate(...args),
    findUniqueOrThrow: jest.fn(async () => ({ id: 'registro', obra_id: 'obra' })),
  },
} }));
jest.mock('../controllers/ingenieria.controller', () => ({ findRegistroWithDetails: jest.fn(async () => ({ id: 'registro' })) }));
jest.mock('../controllers/registroPdf.controller', () => ({ generateRegistroPdfBuffer: (...args: unknown[]) => mockPdf(...args) }));
jest.mock('../services/configuracionCamposRegistro.service', () => ({ obtenerConfiguracionRegistro: jest.fn(async () => []) }));
jest.mock('../services/calculosRegistroTerreno.service', () => ({
  getFactoresAislacionObra: jest.fn(async () => []),
  getFactoresAccesibilidadObra: jest.fn(async () => []),
}));
jest.mock('../services/cloudinary.service', () => ({
  uploadRawBufferToCloudinary: jest.fn(async () => ({ public_id: 'beck/pdfs-firmados/prueba.pdf' })),
  deleteRawFromCloudinary: jest.fn(), withPrivateImageUrl: jest.fn((foto) => foto),
}));
import { validarRegistroCliente } from '../controllers/cliente.controller';
import { findRegistroWithDetails } from '../controllers/ingenieria.controller';
import { obtenerConfiguracionRegistro } from '../services/configuracionCamposRegistro.service';
import { getFactoresAislacionObra } from '../services/calculosRegistroTerreno.service';

test('la firma móvil conserva el mismo nombre en el PDF y en los metadatos, junto a la cuenta y fecha', async () => {
  mockUpdate.mockResolvedValue({ count: 1 });
  mockPdf.mockResolvedValue(Buffer.from('%PDF-1.7'));
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  await validarRegistroCliente({
    user: { id: 'cliente', rol: 'cliente' }, params: { id: 'registro' },
    body: { pathData: 'M 10 10 L 20 20', canvasWidth: 300, canvasHeight: 150 },
  } as unknown as Request, res as unknown as Response);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  expect(mockUpdate).toHaveBeenCalledWith({
    where: { id: 'registro', estado: 'validado', validado_cliente: false },
    data: expect.objectContaining({
      nombre_firmante_cliente: 'Nombre al firmar', validado_cliente_por_id: 'cliente',
      validado_cliente_at: expect.any(Date), pdf_firmado_url: 'beck/pdfs-firmados/prueba.pdf',
    }),
  });
  expect(mockPdf.mock.calls[0][1].firmadoPor).toBe(mockUpdate.mock.calls[0][0].data.nombre_firmante_cliente);
  expect(mockPdf.mock.calls[0][1].firmadoAt).toEqual(mockUpdate.mock.calls[0][0].data.validado_cliente_at);
});

test('la firma resuelve aislación con la configuración de su obra, no por el número del factor', async () => {
  jest.mocked(findRegistroWithDetails).mockResolvedValue({ id: 'registro', aislacion: 1.7 } as any);
  jest.mocked(obtenerConfiguracionRegistro).mockResolvedValue([
    { campo: 'aislacion', appCampo: 'aislacion', color: 'azul', configurable: true, visible: true },
  ]);
  jest.mocked(getFactoresAislacionObra).mockResolvedValue([{ aplica: false, factor: 1.7 }, { aplica: true, factor: 2.2 }]);
  mockUpdate.mockResolvedValue({ count: 1 });
  mockPdf.mockResolvedValue(Buffer.from('%PDF-1.7'));
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  await validarRegistroCliente({ user: { id: 'cliente', rol: 'cliente' }, params: { id: 'registro' },
    body: { pathData: 'M 1 1 L 20 20', canvasWidth: 300, canvasHeight: 220 },
  } as unknown as Request, res as unknown as Response);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  expect(getFactoresAislacionObra).toHaveBeenCalledWith('obra');
  expect(mockPdf).toHaveBeenCalledWith(expect.anything(), expect.anything(), new Set(['aislacion']),
    { accesibilidadTexto: null, aislacionAplica: false });
});
