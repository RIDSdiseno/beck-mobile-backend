import express from "express";
import request from "supertest";

const mockDb = {
  obras: { findMany: jest.fn() },
  asignaciones_inventario_beck: { findMany: jest.fn(), groupBy: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
  trazabilidad_inventario_beck: { findMany: jest.fn() },
};
let mockUser: { rol: string; empresa: string } | null = { rol: "administrador", empresa: "beck" };
jest.mock("../config/prisma", () => ({ prisma: mockDb }));
jest.mock("../middlewares/auth.middleware", () => ({
  verifyAppToken: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!mockUser) return res.sendStatus(401);
    req.user = mockUser as express.Request["user"]; next();
  },
}));
import router from "../routes/inventarioAdmin.routes";
import { asignacionesInventarioAdmin, filtrosInventarioAdmin, resumenInventarioAdmin } from "../services/inventarioAdmin.service";
const app = express(); app.use(router);
const obra = "10000000-0000-4000-8000-000000000001", id = "20000000-0000-4000-8000-000000000002";
const lote = (index = 1) => ({
  id: `30000000-0000-4000-8000-${String(index).padStart(12,"0")}`, tipo_item:"epp", cantidad:2, estado:"asignado", sub_skus:["G-1","G-2"],
  created_at:new Date("2026-09-25T12:00:00Z"), reasignado_at:null, devuelto_at:null, observacion:null,
  recepcion_confirmada_at:null, devolucion_solicitada_at:null, devolucion_recibida_at:null, devolucion_motivo:null,
  inventario_beck_epp:{item:"Guantes",sku:"G",talla:"L",modelo_marca:"Modelo"}, inventario_beck_implementos:null,inventario_beck_herramientas:null,
  usuarios_asignaciones_inventario_beck_asignado_por_idTousuarios:{id:"bodega",nombre:"Bodeguero"},
  usuarios_asignaciones_inventario_beck_jefe_obra_idTousuarios:{id:"supervisor",nombre:"Supervisor"},
  usuarios_asignaciones_inventario_beck_trabajador_idTousuarios:{id:"operario",nombre:"Operario"},consumos:[],
});
beforeEach(() => {
  jest.resetAllMocks(); mockUser={rol:"administrador",empresa:"beck"};
  mockDb.obras.findMany.mockResolvedValue([]);
  mockDb.asignaciones_inventario_beck.findMany.mockResolvedValue([lote()]);
  mockDb.asignaciones_inventario_beck.groupBy.mockResolvedValue([]);
  mockDb.asignaciones_inventario_beck.findFirst.mockResolvedValue({id});
  mockDb.asignaciones_inventario_beck.findUnique.mockResolvedValue({id,sub_skus:[],asignacion_origen_id:null});
  mockDb.trazabilidad_inventario_beck.findMany.mockResolvedValue([]);
});
test.each(["terreno","jefeobra","ingenieria","cliente","bodeguero"])("deniega acceso a %s",async rol=>{
  mockUser={rol,empresa:"beck"};
  await request(app).get("/obras").expect(403);
  await request(app).get(`/asignaciones?obraId=${obra}`).expect(403);
  await request(app).get(`/asignaciones/${id}/trazabilidad?obraId=${obra}`).expect(403);
  expect(mockDb.obras.findMany).not.toHaveBeenCalled();
  expect(mockDb.asignaciones_inventario_beck.findMany).not.toHaveBeenCalled();
});
test("rechaza otras empresas y sesiones ausentes",async()=>{
  mockUser={rol:"administrador",empresa:"firemat"}; await request(app).get("/obras").expect(403);
  mockUser=null; await request(app).get("/obras").expect(401);
});
test("no expone acciones de asignar, devolver ni confirmar consumo",async()=>{
  await request(app).post("/asignaciones").expect(404);
  await request(app).post(`/asignaciones/${id}/recibir`).expect(404);
  await request(app).post(`/consumos/${id}/resolver`).expect(404);
});
test("incluye todas las obras, incluso cerradas o sin asignaciones",async()=>{
  await request(app).get("/obras").expect(200);
  expect(mockDb.obras.findMany.mock.calls[0][0].where).toBeUndefined();
  expect(mockDb.obras.findMany.mock.calls[0][0].select).toEqual({id:true,nombre:true,codigo:true,estado:true});
});
test.each([{}, {obraId:"incorrecto"}, {obraId:obra,vista:"eliminar"}, {obraId:obra,q:["a"]}, {obraId:obra,q:"a".repeat(101)}, {obraId:obra,cursor:"incorrecto"}])("rechaza filtros inválidos %p",query=>{
  expect(()=>filtrosInventarioAdmin(query)).toThrow();
});
test.each(["asignados","supervisores","operarios","devueltos","consumidos","todos"])("mantiene filtro de obra con vista %s y búsqueda",vista=>{
  const {where}=filtrosInventarioAdmin({obraId:obra,vista,q:"Guantes"});
  expect(where.obra_id).toBe(obra); expect(where.OR).toHaveLength(7);
  if(vista==="supervisores")expect(where.trabajador_id).toBeNull();
  if(vista==="operarios")expect(where.trabajador_id).toEqual({not:null});
  if(vista==="consumidos")expect(where.estado).toBe("consumido");
  if(vista==="devueltos")expect(where.estado).toBe("devuelto");
});
test("devuelve actores originales, custodio y cursor sin truncar el resto del listado",async()=>{
  mockDb.asignaciones_inventario_beck.findMany.mockResolvedValue(Array.from({length:51},(_,i)=>lote(i+1)));
  const result=await asignacionesInventarioAdmin({obraId:obra,q:"Supervisor"});
  expect(result.items).toHaveLength(50); expect(result.nextCursor).toBe(lote(50).id);
  expect(result.items[0]).toMatchObject({entregadoPor:{nombre:"Bodeguero"},supervisor:{nombre:"Supervisor"},operario:{nombre:"Operario"}});
  expect(mockDb.asignaciones_inventario_beck.findMany).toHaveBeenCalledWith(expect.objectContaining({take:51,where:expect.objectContaining({obra_id:obra}),orderBy:[{created_at:"desc"},{id:"desc"}]}));
  mockDb.asignaciones_inventario_beck.groupBy.mockClear();
  await asignacionesInventarioAdmin({obraId:obra,cursor:result.nextCursor});
  expect(mockDb.asignaciones_inventario_beck.findMany).toHaveBeenLastCalledWith(expect.objectContaining({cursor:{id:result.nextCursor},skip:1,take:51}));
  expect(mockDb.asignaciones_inventario_beck.groupBy).not.toHaveBeenCalled();
});
test("resumen separa lotes actuales, consumidos e histórico devuelto sin duplicar operarios",async()=>{
  mockDb.asignaciones_inventario_beck.groupBy.mockResolvedValue([
    {estado:"asignado",trabajador_id:null,jefe_obra_id:"s1",_sum:{cantidad:7}},
    {estado:"asignado",trabajador_id:"t1",jefe_obra_id:"s1",_sum:{cantidad:2}},
    {estado:"asignado",trabajador_id:"t1",jefe_obra_id:"s2",_sum:{cantidad:1}},
    {estado:"consumido",trabajador_id:"t1",jefe_obra_id:"s1",_sum:{cantidad:3}},
    {estado:"devuelto",trabajador_id:null,jefe_obra_id:"s3",_sum:{cantidad:5}},
  ]);
  expect(await resumenInventarioAdmin(obra)).toEqual({conSupervisores:7,conOperarios:3,consumidas:3,devueltas:5,supervisores:2,operarios:1});
  expect(mockDb.asignaciones_inventario_beck.groupBy).toHaveBeenCalledWith(expect.objectContaining({where:{obra_id:obra}}));
});
test("trazabilidad rechaza un lote de otra obra y no filtra eventos fuera de ella",async()=>{
  mockDb.asignaciones_inventario_beck.findFirst.mockResolvedValue(null);
  await request(app).get(`/asignaciones/${id}/trazabilidad?obraId=${obra}`).expect(404);
  expect(mockDb.trazabilidad_inventario_beck.findMany).not.toHaveBeenCalled();
});
test("trazabilidad incluye actores y destinatarios, respeta obra y pagina",async()=>{
  mockDb.trazabilidad_inventario_beck.findMany.mockResolvedValue([{id,accion:"ASIGNADO_OPERARIO",cantidad:2,detalle:"Entrega",created_at:new Date(),
    usuarios_trazabilidad_inventario_beck_actor_idTousuarios:{nombre:"Supervisor A"},
    usuarios_trazabilidad_inventario_beck_jefe_obra_idTousuarios:{nombre:"Supervisor A"},
    usuarios_trazabilidad_inventario_beck_trabajador_idTousuarios:{nombre:"Operario B"}}]);
  const result=await request(app).get(`/asignaciones/${id}/trazabilidad?obraId=${obra}&page=2`).expect(200);
  expect(result.body.data.items[0]).toMatchObject({actor:"Supervisor A",operario:"Operario B"});
  expect(mockDb.trazabilidad_inventario_beck.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({obra_id:obra}),take:51,skip:50}));
});
