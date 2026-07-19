# GitHub Governance — Ruleset Base

## Objetivo

Definir reglas claras para colaborar en Bonafide Hub sin frenar al resto del equipo.

Buscamos:

- Calidad minima consistente.
- Cambios pequenos y revisables.
- Historial de Git limpio.
- Seguridad basica desde el inicio.

---

## Branching model (inicial)

Branches principales:

- `main`: estado estable y desplegable.
- `develop` (opcional): integracion continua si el equipo crece.

Branches de trabajo:

- `feat/<scope>-<short-name>`
- `fix/<scope>-<short-name>`
- `chore/<scope>-<short-name>`
- `docs/<scope>-<short-name>`

Ejemplos:

- `feat/bot-ping-command`
- `fix/api-auth-null-user`
- `docs/platform-readme-update`

---

## Reglas de push

- No hacer push directo a `main`.
- Todo cambio entra por Pull Request.
- Hacer push frecuente a la branch de trabajo para no perder progreso.
- Commits pequenos con mensaje claro.
- No subir secretos (`.env`, tokens, keys, credenciales).

---

## Requisitos de Pull Request

Un PR debe incluir:

- Objetivo del cambio.
- Contexto funcional/tecnico.
- Como probarlo.
- Riesgos o efectos secundarios conocidos.
- Checklist de calidad completado.

Reglas recomendadas para merge:

- Minimo 1 aprobacion.
- Todos los checks requeridos en verde.
- Sin conversaciones sin resolver.
- Branch actualizada con `main`.

---

## Checks antes del push (local)

Checklist minimo recomendado:

1. Confirmar branch correcta.
2. Revisar `git status`.
3. Ejecutar tests de la parte afectada (cuando existan).
4. Ejecutar lint/format de la parte afectada (cuando existan).
5. Buscar conflictos o markers (`<<<<<<<`, `=======`, `>>>>>>>`).
6. Confirmar que no hay secretos ni archivos sensibles en staging.

Comandos utiles:

```bash
git status
git diff --staged
git fetch origin
git rebase origin/main
```

---

## Checks en CI (iniciales)

Checks base sugeridos para este estado temprano del repo:

- Deteccion de conflict markers.
- Bloqueo de archivos `.env` versionados.
- Estructura minima de repo valida.

Cuando se definan stacks concretos, extender con:

- Lint.
- Typecheck.
- Unit tests.
- Integration tests.
- Build verification.

---

## Proteccion de branch (recomendado)

Configurar en `main`:

- Require a pull request before merging.
- Require approvals: 1.
- Dismiss stale approvals when new commits are pushed.
- Require status checks to pass.
- Require conversation resolution before merge.
- Restrict who can push (opcional, segun equipo).
- Do not allow force pushes.
- Do not allow deletions.

---

## Estrategia de merge

Recomendacion inicial:

- Usar `Squash and merge` para mantener historial limpio.
- Titulo del PR debe describir el cambio funcional.

---

## Definition of Done para merge

Antes de mergear un PR:

- Objetivo cumplido.
- Codigo revisado.
- Checks de CI en verde.
- Sin secretos hardcodeados.
- Documentacion actualizada si aplica.
- Pasos de prueba descritos y validados.
