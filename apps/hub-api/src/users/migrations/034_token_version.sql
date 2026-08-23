-- SEC-220 — invalidación de sesiones.
--
-- El JWT no se podía matar antes de tiempo: cambiar la contraseña no tocaba
-- ninguna sesión y el logout solo borraba `localStorage`, así que un token
-- robado sobrevivía a la reacción de la víctima durante todo el TTL.
--
-- `token_version` viaja firmada dentro del token y se compara en cada petición
-- contra esta columna. `requireAuth` ya lee la fila para el chequeo de estado
-- (y, desde SEC-224, para el rol y las apps), así que la comparación no añade
-- consulta. Incrementarla invalida TODOS los tokens vivos de esa persona; lo
-- hacen el cambio de contraseña y el logout.
--
-- NOT NULL DEFAULT 0 a propósito: los tokens ya emitidos no llevan el campo y
-- se leen como 0, que es lo que esta columna vale para todo el mundo. Es decir,
-- aplicar esta migración NO desloguea a nadie.
ALTER TABLE portal.users
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
