# GitHub Governance — Ruleset Base

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

- Se puede hacer push directo a `main`, siempre que el typecheck y el build
  pasen antes del push.
- Si el cambio necesita revision, va por branch + Pull Request.
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

- Require a pull request before merging: solo si se quiere bloquear el push
  directo; **dejarlo desactivado** si se permite (ver Reglas de push).
- Require status checks to pass.
- Require conversation resolution before merge.
- Restrict who can push (opcional).
- Do not allow force pushes.
- Do not allow deletions.

Sin `Require approvals` mientras el repo lo mantenga una sola persona: GitHub
no permite aprobar el PR propio.

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
