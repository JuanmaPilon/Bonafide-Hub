# Guild Platform — Planning General

## 1. Visión general

El objetivo es crear una plataforma propia para gestionar y mejorar la experiencia de una guild/comunidad de Discord.

La plataforma estaría compuesta inicialmente por dos proyectos principales:

1. **Discord Guild Bot**
2. **Guild Hub Web App**

Ambos proyectos deberían diseñarse pensando desde el principio en una futura integración.

La idea es que el bot y la web no sean dos sistemas aislados, sino dos interfaces distintas que interactúan con una misma lógica y una misma fuente de datos.

Ejemplo:

```text
Discord
   │
   │
Discord Bot
   │
   ├──────────────┐
   │              │
Servicios      Base de datos
   │              │
   └────── API ───┘
              │
          Guild Hub
              │
        Frontend Web
```

Ejemplo de una futura integración:

```text
Evento de Raid
      │
      ├── Creado desde Discord
      │
      └── Creado desde la Web
             │
             ▼
      Sistema de Eventos
             │
      ┌──────┴──────┐
      │             │
   Discord         Web
```

El objetivo es evitar que Discord y la web implementen la misma lógica dos veces.

---

# 2. Objetivos generales

Los objetivos principales del proyecto son:

- Crear herramientas útiles para la guild.
- Automatizar tareas administrativas de Discord.
- Crear un sistema modular que pueda crecer con nuevas funcionalidades.
- Desarrollar una aplicación web que funcione como hub de la comunidad.
- Integrar Discord y la web.
- Aprender desarrollo de software durante todo el proceso.
- Practicar arquitectura, backend, frontend, bases de datos, infraestructura y DevOps.
- Entender cómo funciona cada parte del sistema.
- Trabajar en equipo utilizando Git, Issues, Pull Requests y Code Review.

El proyecto tiene por lo tanto un objetivo doble:

```text
Construir un producto útil
+
Aprender cómo funciona
```

---

# 3. Filosofía del proyecto

Este proyecto no busca simplemente generar código hasta llegar a un resultado funcional.

Uno de los objetivos principales es aprender durante el desarrollo.

Queremos poder entender:

- Qué estamos construyendo.
- Por qué se toma una decisión técnica.
- Cómo se conectan las distintas partes.
- Qué alternativas existen.
- Qué ventajas y desventajas tiene cada alternativa.
- Cómo probar lo que construimos.
- Cómo desplegarlo.
- Cómo mantenerlo.

Las herramientas de IA deberían utilizarse como apoyo y no como sustituto del aprendizaje.

Idealmente, el flujo debería ser:

```text
Problema
   │
   ▼
Entender qué queremos resolver
   │
   ▼
Analizar posibles soluciones
   │
   ▼
Explicar conceptos necesarios
   │
   ▼
Elegir una solución
   │
   ▼
Implementar paso a paso
   │
   ▼
Probar
   │
   ▼
Analizar el resultado
   │
   ▼
Refactorizar o mejorar
```

El objetivo final no es únicamente terminar el proyecto.

El objetivo es:

```text
Entender
+
Construir
+
Practicar
+
Mejorar
```

---

# 4. Organización recomendada del proyecto

Si ambos proyectos van a ser desarrollados por el mismo grupo de personas, una buena opción sería utilizar un monorepo.

Ejemplo:

```text
guild-platform/
│
├── apps/
│   ├── discord-bot/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── database/
│   ├── shared/
│   ├── config/
│   └── services/
│
├── infrastructure/
│   ├── docker/
│   └── deployment/
│
├── docs/
│   ├── architecture/
│   ├── development/
│   ├── deployment/
│   └── learning/
│
├── .github/
│   └── workflows/
│
├── docker-compose.yml
├── README.md
└── .env.example
```

Esto permitiría compartir:

- Tipos.
- Modelos.
- Validaciones.
- Acceso a base de datos.
- Servicios.
- Configuración.
- Lógica de eventos.
- Sistema de permisos.
- Utilidades.

La arquitectura debería ser modular para que cada funcionalidad pueda desarrollarse de forma relativamente independiente.

---

# 5. Stack técnico inicial sugerido

Una opción razonable para comenzar sería:

```text
Lenguaje
TypeScript

Discord Bot
discord.js

Backend
Node.js + framework a definir

Frontend
React / Next.js

Database
PostgreSQL

ORM
Prisma o Drizzle

Deployment
Docker

Repository
GitHub

CI/CD
GitHub Actions
```

Estas decisiones deberían revisarse antes de confirmarlas.

Para cada tecnología conviene analizar:

- Ventajas.
- Desventajas.
- Curva de aprendizaje.
- Complejidad.
- Necesidades actuales.
- Escalabilidad futura.

---

# 6. Proyecto 1 — Discord Guild Bot

## Objetivo

Crear un bot privado para Discord capaz de automatizar tareas administrativas y sociales del servidor.

El bot debe ser modular para que puedan agregarse funcionalidades progresivamente.

---

## Fase 0 — Definición técnica

Antes de comenzar a implementar funcionalidades se debe definir:

- Lenguaje.
- Librería de Discord.
- Base de datos.
- ORM.
- Sistema de configuración.
- Hosting.
- Sistema de logs.
- CI/CD.
- Arquitectura.
- Estrategia de desarrollo.

La arquitectura debería separar claramente:

```text
Discord Events
Commands
Business Logic
Database
Configuration
External Services
```

---

## Fase 1 — Setup del proyecto

### Objetivo

Tener un bot vacío funcionando correctamente tanto en desarrollo como en producción.

### Tareas iniciales

- Crear aplicación de Discord.
- Crear el bot dentro de Discord Developer Portal.
- Configurar intents y permisos.
- Invitar el bot al servidor de desarrollo.
- Crear estructura inicial del repositorio.
- Configurar TypeScript.
- Configurar linting y formatting.
- Crear `.env.example`.
- Crear sistema de configuración.
- Crear conexión inicial con Discord.
- Crear sistema de carga de eventos.
- Crear sistema de comandos.
- Crear comando `/ping`.
- Crear sistema básico de logging.
- Crear Dockerfile.
- Crear entorno local mediante Docker Compose.
- Configurar CI.
- Documentar cómo levantar el proyecto localmente.

### Resultado esperado

Cualquier desarrollador debería poder hacer algo equivalente a:

```bash
git clone
cp .env.example .env
docker compose up
```

y tener el bot funcionando.

---

## Fase 2 — Configuración del servidor

El bot debería poder guardar configuraciones específicas para cada servidor.

Ejemplo:

```text
GuildConfig

guildId
logsChannelId
welcomeChannelId
defaultRoleId
xpEnabled
nicknameSystemEnabled
dynamicVoiceEnabled
musicEnabled
```

Esto evita valores hardcodeados.

Las configuraciones podrían modificarse inicialmente mediante comandos administrativos.

Ejemplo:

```text
/config logs-channel
/config default-role
/config xp enable
/config nickname-system enable
```

En el futuro estas configuraciones podrían administrarse desde el Guild Hub.

---

## Fase 3 — Sistema de logs

### MVP

Registrar:

- Usuario entra al servidor.
- Usuario abandona el servidor.

Después se podrían agregar:

- Roles agregados.
- Roles eliminados.
- Cambios de nickname.
- Mensajes eliminados.
- Cambios administrativos.

Es importante diferenciar:

```text
Application Logs
```

Errores o información técnica del bot.

de:

```text
Discord Audit Logs
```

Eventos relevantes para administradores.

---

## Fase 4 — Sistema automático de roles

Permitir definir reglas para asignar roles automáticamente.

MVP:

```text
Nuevo usuario
      │
      ▼
Default Role
```

Posteriormente:

```text
Nivel XP
   │
   ├── Nivel 10 → Role A
   ├── Nivel 20 → Role B
   └── Nivel 30 → Role C
```

También podrían existir reglas basadas en:

- Roles previos.
- Actividad.
- Rango.
- Estado dentro de la guild.
- Participación en raids.

---

## Fase 5 — Sistema de XP

El sistema debería permitir otorgar XP por actividad.

Ejemplo:

```text
Mensaje enviado
      │
      ▼
Cooldown de XP
      │
      ▼
Agregar XP
      │
      ▼
Calcular nivel
      │
      ▼
Verificar recompensa
```

El sistema debería tener mecanismos contra spam.

Posibles comandos:

```text
/rank
/leaderboard
/xp user
```

Posibles funcionalidades futuras:

- Multiplicadores de XP.
- XP por participar en eventos.
- XP por raids.
- XP por tiempo en voz.
- Roles por nivel.

---

## Fase 6 — Nicknames automáticos

Permitir modificar automáticamente los nicknames según reglas.

Ejemplo:

```text
Usuario
Juan

Rango
Officer

Nickname
⭐ Juan
```

Otro ejemplo:

```text
Guild Master
👑 Juan
```

El sistema debería evitar modificaciones acumulativas.

Incorrecto:

```text
⭐ Juan
⭐⭐ Juan
⭐⭐⭐ Juan
```

El sistema debe aplicar reglas idempotentes.

También debe respetar la jerarquía de permisos de Discord.

---

## Fase 7 — Salas de voz dinámicas

Sistema para crear automáticamente salas temporales.

Ejemplo:

```text
➕ Crear sala
      │
Usuario entra
      │
      ▼
Bot crea:

Juan's Room
      │
Usuario es movido
      │
      ▼
Sala queda vacía
      │
      ▼
Bot elimina la sala
```

Opciones futuras:

- Cambiar nombre.
- Cambiar límite de usuarios.
- Bloquear sala.
- Permitir usuarios.
- Transferir ownership.

---

## Fase 8 — Sistema de música

Debería desarrollarse como un módulo independiente.

Funciones iniciales:

```text
/play
/pause
/resume
/skip
/queue
/stop
```

El sistema debería manejar:

- Cola.
- Reconexión.
- Usuario abandonando el canal.
- Bot desconectado.
- Errores de reproducción.

Este módulo puede dejarse para después del MVP principal debido a su complejidad externa.

---

## Fase 9 — Sistema de eventos

Este módulo debería convertirse en uno de los principales puentes entre Discord y el Guild Hub.

Ejemplo:

```text
/event create raid
```

Los usuarios podrían anotarse mediante Discord.

Posteriormente la misma información debería estar disponible en la web.

---

## Fase 10 — Deployment

El proyecto debería tener como mínimo:

```text
Development
Production
```

Opcionalmente:

```text
Staging
```

Flujo esperado:

```text
GitHub
   │
Pull Request
   │
Tests
   │
Merge main
   │
CI/CD
   │
Docker Build
   │
Deploy
```

Hay que configurar:

- Hosting del bot.
- Hosting de PostgreSQL.
- Backups.
- Variables de entorno.
- Secrets.
- Logs.
- Restart automático.
- Health checks.

El bot debería ejecutarse como un proceso persistente.

---

# 7. MVP recomendado del Discord Bot

## MVP 1

```text
Bot online
Comandos
Configuración
Logs de entrada/salida
Auto roles
Base de datos
Deployment
```

## MVP 2

```text
Sistema XP
Rank
Leaderboard
Roles por nivel
Nicknames automáticos
```

## MVP 3

```text
Salas dinámicas
Eventos
Integración inicial con Guild Hub
```

## MVP 4

```text
Música
Features sociales
Features experimentales
```

El primer objetivo no debería ser:

> Crear el bot completo.

El primer objetivo debería ser:

> Tener una infraestructura donde agregar una nueva funcionalidad al bot sea fácil, segura, entendible y desplegable.

---

# 8. Proyecto 2 — Guild Hub

## Objetivo

Crear una aplicación web que funcione como centro de la guild.

La plataforma debería permitir interactuar con información proveniente tanto de Discord como de sistemas internos.

Arquitectura:

```text
Browser
   │
Frontend
   │
Backend API
   │
Services
   │
Database
   │
Discord Bot
```

---

## Fase 1 — Autenticación

Utilizar Discord como identidad principal.

Ejemplo:

```text
Login with Discord
      │
      ▼
Discord OAuth
      │
      ▼
Usuario identificado
      │
      ▼
Verificar guild
      │
      ▼
Verificar roles
```

Los permisos de la web podrían derivarse de Discord.

Ejemplo:

```text
Guild Master
Admin completo

Officer
Gestión de raids

Raider
Inscripción

Member
Acceso básico
```

---

## Fase 2 — Dashboard

La página principal podría mostrar:

```text
Próxima Raid

Próximos Eventos

Anuncios importantes

Actividad reciente

Mi estado de inscripción
```

---

## Fase 3 — Sistema de raids

Esta sería probablemente la funcionalidad principal inicial.

Los jugadores podrían indicar:

```text
Disponible

Tentativo

No disponible
```

También podrían indicar:

```text
Personaje
Clase
Spec
Rol
```

---

## Fase 4 — Integración Discord ↔ Web

La información debería tener una única fuente de verdad.

Ejemplo:

```text
Raid creada desde Web
        │
        ▼
Base de datos
        │
        ▼
Bot publica mensaje en Discord
```

Y:

```text
Jugador se anota desde Discord
        │
        ▼
Bot actualiza evento
        │
        ▼
Base de datos
        │
        ▼
Web actualizada
```

Esto evita mantener dos sistemas separados.

---

## Fase 5 — Aplicaciones para raidear

Crear un sistema de aplicación.

Posibles datos:

```text
BattleTag
Discord
Personaje
Clase
Spec
Item Level
Logs
Experiencia
Disponibilidad
Comentarios
```

Estados:

```text
Pending
Reviewing
Accepted
Rejected
Trial
```

Los officers podrían gestionar las aplicaciones desde la web.

---

## Fase 6 — Hub de contenido de Discord

Mostrar contenido destacado del servidor.

Inicialmente se recomienda utilizar un sistema explícito.

Ejemplo:

```text
📌 Destacar mensaje
```

El bot guarda el mensaje como destacado.

Después aparece en:

```text
Guild Hub
→ Highlights
```

Más adelante se podría agregar:

- Mensajes con muchas reacciones.
- Clips.
- Screenshots.
- Memes.
- Momentos destacados.
- Rankings semanales.

---

## Fase 7 — Organización de eventos

Permitir eventos distintos de raids.

Ejemplos:

```text
Raid
Mythic+
PvP
Guild Meeting
Achievement Run
Juego externo
Evento social
```

Un mismo sistema de eventos debería soportar diferentes tipos.

---

# 9. Modelo de datos inicial

Entidades aproximadas:

```text
User

DiscordAccount

Guild

GuildMember

GuildConfig

Role

Event

EventSignup

Raid

RaidSignup

RaidApplication

XPProfile

XPTransaction

HighlightedMessage

AuditLog
```

No es necesario implementar todo desde el principio.

La base de datos debería evolucionar junto con las funcionalidades.

---

# 10. División del trabajo entre compañeros

La división debería hacerse por áreas de responsabilidad y no simplemente repartiendo archivos.

## Workstream A — Core / Architecture

Responsabilidades:

```text
Arquitectura
Estructura del repo
Configuración
Shared packages
Database
CI/CD
Docker
```

## Workstream B — Discord Bot

Responsabilidades:

```text
Discord events
Commands
Roles
XP
Nicknames
Voice channels
Music
```

## Workstream C — Backend

Responsabilidades:

```text
API
Authentication
Authorization
Business logic
Database services
Discord integration
```

## Workstream D — Frontend

Responsabilidades:

```text
Dashboard
Raid UI
Event UI
Applications
Guild management
```

## Workstream E — Infrastructure

Responsabilidades:

```text
Hosting
Docker
Database hosting
Secrets
Deployment
Monitoring
Backups
```

Una misma persona puede cubrir varios workstreams.

---

# 11. Ejemplo para un equipo de 3 personas

## Persona A

```text
Arquitectura
Database
Backend
API
```

## Persona B

```text
Discord Bot
Events
Roles
XP
Voice
```

## Persona C

```text
Frontend
Discord OAuth
Dashboard
Raid UI
```

Infraestructura y decisiones arquitectónicas deberían ser compartidas.

---

# 12. Flujo de trabajo recomendado

Cada feature debería seguir:

```text
Issue
   │
   ▼
Branch
   │
   ▼
Development
   │
   ▼
Tests
   │
   ▼
Pull Request
   │
   ▼
Code Review
   │
   ▼
Merge
   │
   ▼
Deploy
```

Ejemplo de branches:

```text
feat/BOT-023-xp-system
feat/WEB-012-raid-signup
fix/BOT-031-nickname-update
```

---

# 13. Formato recomendado para las tareas

Cada tarea debería contener:

```text
ID
Título
Objetivo
Descripción
Requisitos
Pasos técnicos
Criterios de aceptación
Dependencias
Tests necesarios
Estimación
Perfil recomendado
Tareas que pueden ejecutarse en paralelo
```

---

# 14. Orden recomendado de desarrollo global

```text
1. Repository Setup
        ↓
2. Discord Bot Core
        ↓
3. Database
        ↓
4. Bot Configuration
        ↓
5. Join/Leave Logs
        ↓
6. Auto Roles
        ↓
7. Deployment
        ↓
8. XP System
        ↓
9. Nickname System
        ↓
10. Dynamic Voice
        ↓
11. Event System
        ↓
12. Backend API
        ↓
13. Discord Authentication
        ↓
14. Guild Hub Frontend
        ↓
15. Raid System
        ↓
16. Discord ↔ Web Integration
        ↓
17. Applications
        ↓
18. Highlights
        ↓
19. Music
        ↓
20. Nuevas funcionalidades
```

---

# 15. Aprendizaje durante el desarrollo

Cada implementación debería tener contexto suficiente para entender:

- Qué problema resuelve.
- Cómo encaja en el sistema.
- Qué conceptos técnicos aparecen.
- Qué alternativas existen.
- Por qué se elige una solución.
- Cómo se prueba.
- Qué podría mejorarse más adelante.

Siempre que una parte sea especialmente útil para practicar, se debería intentar que quien la desarrolla participe activamente en lugar de simplemente copiar una solución completa.

Por ejemplo:

```text
Explicación
   ↓
Pseudocódigo o guía
   ↓
Intento de implementación
   ↓
Revisión
   ↓
Correcciones
   ↓
Resultado final
```

---

# 16. Learning Notes

Cada feature importante podría dejar documentación corta sobre lo aprendido.

Ejemplo:

```text
docs/
└── learning/
    ├── discord-events.md
    ├── docker-basics.md
    ├── postgres-basics.md
    ├── authentication-oauth.md
    ├── rest-api-basics.md
    └── ci-cd-basics.md
```

El objetivo es poder volver meses después y entender:

- Qué aprendimos.
- Cómo funciona esa parte.
- Qué decisiones tomamos.
- Qué problemas encontramos.
- Cómo los resolvimos.

---

# 17. Principios generales

Durante el desarrollo se debería priorizar:

- Modularidad.
- Separación de responsabilidades.
- Código mantenible.
- Tipado fuerte.
- Evitar lógica duplicada.
- No hardcodear secrets.
- No hardcodear IDs de Discord.
- Configuración mediante variables de entorno.
- Manejo correcto de errores.
- Logging estructurado.
- Tests para lógica crítica.
- Docker para entornos reproducibles.
- CI/CD automatizado.
- Documentación técnica.
- Evitar sobreingeniería.

Cuando una funcionalidad pueda utilizarse tanto desde Discord como desde la web, la lógica de negocio debería estar en una capa compartida o servicio reutilizable.

---

# 18. Definición general de terminado

Una tarea debería considerarse terminada cuando:

- El código está implementado.
- El código fue revisado.
- Los tests necesarios están pasando.
- No hay secretos hardcodeados.
- Las variables nuevas están documentadas en `.env.example`.
- La documentación está actualizada cuando corresponde.
- CI está pasando.
- La Pull Request fue aprobada.
- La funcionalidad fue probada en un ambiente de desarrollo.

---

# 19. Resultado esperado del proyecto

El objetivo a largo plazo es terminar con una plataforma donde:

```text
Discord
   │
   ├── Bot
   │
   └── Eventos / Interacciones
          │
          ▼
      Servicios compartidos
          │
          ▼
      Base de datos
          │
          ▼
      Backend API
          │
          ▼
      Guild Hub
```

El bot y la web deberían evolucionar progresivamente.

No se busca construir todo de una sola vez.

Se busca construir una base sólida, aprender durante el proceso y agregar funcionalidades de forma incremental.
