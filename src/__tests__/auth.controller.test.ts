import request from "supertest";

// ── Mocks deben ir antes del import de app ────────────────────────────────────

const mockFindFirst = jest.fn();
const mockUpdate    = jest.fn();

jest.mock("../config/prisma", () => ({
  prisma: {
    usuarios: {
      findFirst: (...args: any[]) => mockFindFirst(...args),
      update:    (...args: any[]) => mockUpdate(...args),
    },
  },
}));

jest.mock("../services/microsoftAuth.service", () => ({
  verifyMicrosoftIdToken: jest.fn(),
}));

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash:    jest.fn(),
}));

// ── Variables de entorno mínimas para que env.ts no explote ─────────────────
process.env.JWT_SECRET          = "test-secret-key-minimo-32-caracteres!!";
process.env.AZURE_AD_CLIENT_ID  = "test-client-id";
process.env.AZURE_AD_TENANT_ID  = "test-tenant-id";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY    = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";

import app from "../app";
import bcrypt from "bcryptjs";

const bcryptCompare = bcrypt.compare as jest.Mock;

// ── Helpers ───────────────────────────────────────────────────────────────────

const USUARIO_CLIENTE = {
  id:            "uuid-cliente-1",
  nombre:        "Test Cliente",
  email:         "cliente@example.com",
  rol:           "cliente",
  password_hash: "$2b$10$hasheado",
  azure_id:      null,
  activo:        true,
};

const USUARIO_BECK = {
  id:            "uuid-terreno-1",
  nombre:        "Test Terreno",
  email:         "terreno@becksoluciones.cl",
  rol:           "terreno",
  password_hash: "$2b$10$hasheado",
  azure_id:      null,
  activo:        true,
};

// ── Tests: POST /api/mobile/auth/email ────────────────────────────────────────

describe("POST /api/mobile/auth/email", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    bcryptCompare.mockReset();
  });

  it("rechaza si no se envía body", async () => {
    const res = await request(app)
      .post("/api/mobile/auth/email")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rechaza si falta la contraseña", async () => {
    const res = await request(app)
      .post("/api/mobile/auth/email")
      .send({ email: "user@becksoluciones.cl" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rechaza usuario inexistente con 401", async () => {
    mockFindFirst.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/mobile/auth/email")
      .send({ email: "noexiste@becksoluciones.cl", password: "cualquiera" });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("rechaza contraseña incorrecta con 401", async () => {
    mockFindFirst.mockResolvedValue(USUARIO_BECK);
    bcryptCompare.mockResolvedValue(false);

    const res = await request(app)
      .post("/api/mobile/auth/email")
      .send({ email: "terreno@becksoluciones.cl", password: "wrong" });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("devuelve token con credenciales válidas (rol terreno)", async () => {
    mockFindFirst.mockResolvedValue(USUARIO_BECK);
    bcryptCompare.mockResolvedValue(true);

    const res = await request(app)
      .post("/api/mobile/auth/email")
      .send({ email: "terreno@becksoluciones.cl", password: "correcta" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user.rol).toBe("terreno");
  });

  it("permite login a cliente con cualquier dominio de email", async () => {
    mockFindFirst.mockResolvedValue(USUARIO_CLIENTE);
    bcryptCompare.mockResolvedValue(true);

    const res = await request(app)
      .post("/api/mobile/auth/email")
      .send({ email: "cliente@example.com", password: "correcta" });

    expect(res.status).toBe(200);
    expect(res.body.user.rol).toBe("cliente");
  });

  it("bloquea a usuario Beck con dominio externo (no cliente)", async () => {
    const usuarioExterno = { ...USUARIO_BECK, email: "terreno@gmail.com" };
    mockFindFirst.mockResolvedValue(usuarioExterno);
    bcryptCompare.mockResolvedValue(true);

    const res = await request(app)
      .post("/api/mobile/auth/email")
      .send({ email: "terreno@gmail.com", password: "correcta" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ── Tests: middleware verifyAppToken ──────────────────────────────────────────

describe("verifyAppToken middleware", () => {
  it("rechaza petición sin header Authorization", async () => {
    const res = await request(app).get("/api/cliente/obras");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("rechaza token malformado", async () => {
    const res = await request(app)
      .get("/api/cliente/obras")
      .set("Authorization", "Bearer token-invalido");

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("rechaza header sin prefijo Bearer", async () => {
    const res = await request(app)
      .get("/api/cliente/obras")
      .set("Authorization", "Basic dXNlcjpwYXNz");

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ── Tests: validarRegistroCliente — validación de inputs ─────────────────────

describe("POST /api/cliente/registros/:id/validar — validación de firma", () => {
  it("rechaza sin token (401 antes de llegar a la validación de body)", async () => {
    const res = await request(app)
      .post("/api/cliente/registros/uuid-registro-1/validar")
      .send({ pathData: "M 0 0", canvasWidth: 300, canvasHeight: 150 });

    expect(res.status).toBe(401);
  });
});
