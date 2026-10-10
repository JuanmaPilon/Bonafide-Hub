import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowsClockwise,
  CaretDown,
  DownloadSimple,
  Lightning,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  TrendUp,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { GuildRole, XpConfig, XpRoleRule } from "./api";
import { roleChipClass, roleChipStyle, roleColorHex, roleNameStyle } from "./roles";

type XpSectionProps = {
  config: XpConfig;
  dirty: boolean;
  guildRoles: GuildRole[];
  onChange: (updater: (current: XpConfig) => XpConfig) => void;
  onExport: () => void;
  onImport: () => void;
  onResetAll: () => void;
  onSave: () => void;
  onSyncRoles: () => void;
  saving: boolean;
  savingAny: boolean;
  notify: (message: string, kind?: "success" | "error") => void;
};

function ConfigNumber({
  clampMin,
  label,
  onChange,
  value,
}: {
  clampMin?: number;
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        min={clampMin ?? 1}
        onChange={(event) => {
          const next = Number(event.target.value) || 0;
          onChange(clampMin === undefined ? next : Math.max(clampMin, next));
        }}
        type="number"
        value={value}
      />
    </label>
  );
}

// Campo con etiqueta: el mismo par etiqueta + control del resto del panel.
function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label>
      <span>{label}</span>
      {children}
    </label>
  );
}

function roleName(role?: GuildRole): string {
  return role?.name ?? "Nombre";
}

// Editor del módulo de XP: los números de configuración, los roles por nivel
// (una fila por nivel, el detalle en una ventana emergente) y los
// multiplicadores. El estado vive en el App: acá solo se edita.
export function XpSection({
  config,
  dirty,
  guildRoles,
  onChange,
  onExport,
  onImport,
  onResetAll,
  onSave,
  onSyncRoles,
  saving,
  savingAny,
  notify,
}: XpSectionProps) {
  const [editingLevel, setEditingLevel] = useState<number | null>(null);
  const [extrasView, setExtrasView] = useState<"add" | "remove" | null>(null);
  const [roleSearch, setRoleSearch] = useState("");

  const rules = useMemo(
    () => [...config.levelRoles].sort((left, right) => left.level - right.level),
    [config.levelRoles],
  );
  const editing =
    editingLevel === null
      ? undefined
      : config.levelRoles.find((rule) => rule.level === editingLevel);

  const closeEditor = (): void => {
    setEditingLevel(null);
    setExtrasView(null);
    setRoleSearch("");
  };

  const openEditor = (level: number): void => {
    setEditingLevel(level);
    setExtrasView(null);
    setRoleSearch("");
  };

  useEffect(() => {
    if (!editing) {
      return undefined;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeEditor();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [editing]);

  function patch(updater: (current: XpConfig) => XpConfig): void {
    onChange(updater);
  }

  function patchRule(level: number, values: Partial<XpRoleRule>): void {
    patch((current) => ({
      ...current,
      levelRoles: current.levelRoles.map((rule) =>
        rule.level === level ? { ...rule, ...values } : rule,
      ),
    }));
  }

  // Cambiar el nivel es cambiar la clave de la regla: si el nivel destino ya
  // existe, se avisa y no se toca nada.
  function changeLevel(from: number, rawValue: number): void {
    if (!Number.isFinite(rawValue)) {
      return;
    }
    const level = Math.floor(rawValue);
    if (level < 0 || level === from) {
      return;
    }
    if (config.levelRoles.some((rule) => rule.level === level)) {
      notify("Ese nivel ya está asignado a otro rol.", "error");
      return;
    }
    patchRule(from, { level });
    setEditingLevel(level);
  }

  function addRule(): void {
    const nextLevel =
      config.levelRoles.reduce((max, rule) => Math.max(max, rule.level), 0) + 1;
    patch((current) => ({
      ...current,
      levelRoles: [
        ...current.levelRoles,
        {
          addRoleIds: [],
          level: nextLevel,
          nicknamePrefix: "",
          removeRoleIds: [],
          roleId: "",
          stacking: "stack",
        },
      ],
    }));
    openEditor(nextLevel);
  }

  function removeRule(level: number): void {
    patch((current) => ({
      ...current,
      levelRoles: current.levelRoles.filter((rule) => rule.level !== level),
    }));
    if (editingLevel === level) {
      closeEditor();
    }
  }

  function addMultiplier(): void {
    const used = new Set(config.roleMultipliers.map((entry) => entry.roleId));
    const available = guildRoles.find((role) => !used.has(role.id));
    patch((current) => ({
      ...current,
      roleMultipliers: [
        ...current.roleMultipliers,
        { multiplier: 2, roleId: available?.id ?? "" },
      ],
    }));
  }

  function updateMultiplier(multiplier: number, roleId: string): void {
    patch((current) => ({
      ...current,
      roleMultipliers: current.roleMultipliers.map((entry) =>
        entry.roleId === roleId ? { ...entry, multiplier } : entry,
      ),
    }));
  }

  function changeMultiplierRole(fromRoleId: string, nextRoleId: string): void {
    patch((current) => ({
      ...current,
      roleMultipliers: current.roleMultipliers.map((entry) =>
        entry.roleId === fromRoleId ? { ...entry, roleId: nextRoleId } : entry,
      ),
    }));
  }

  function removeMultiplier(roleId: string): void {
    patch((current) => ({
      ...current,
      roleMultipliers: current.roleMultipliers.filter(
        (entry) => entry.roleId !== roleId,
      ),
    }));
  }

  const editingRole = guildRoles.find((role) => role.id === editing?.roleId);
  const previewStyle = editing
    ? roleNameStyle(
        roleColorHex(editingRole?.color) ?? undefined,
        roleColorHex(editingRole?.secondaryColor) ?? undefined,
      )
    : undefined;

  const extrasIds =
    extrasView === "remove"
      ? (editing?.removeRoleIds ?? [])
      : (editing?.addRoleIds ?? []);
  const search = roleSearch.trim().toLowerCase();
  const extrasRoles = guildRoles.filter(
    (role) => !search || role.name.toLowerCase().includes(search),
  );

  return (
    <div className="xp-section">
      <section className="admin-group">
        <span className="admin-group-head">
          <Lightning weight="fill" aria-hidden="true" />
          Cómo se gana XP
        </span>
        <div className="form-grid">
          <ConfigNumber
            label="XP por mensaje"
            onChange={(messageXp) =>
              patch((current) => ({ ...current, messageXp }))
            }
            value={config.messageXp}
          />
          <ConfigNumber
            label="XP por minuto en voz"
            onChange={(voiceXpPerMinute) =>
              patch((current) => ({ ...current, voiceXpPerMinute }))
            }
            value={config.voiceXpPerMinute}
          />
          <ConfigNumber
            label="Cooldown anti-spam (segundos)"
            onChange={(cooldownSeconds) =>
              patch((current) => ({ ...current, cooldownSeconds }))
            }
            value={config.cooldownSeconds}
          />
        </div>
      </section>

      <section className="admin-group">
        <span className="admin-group-head">
          <TrendUp weight="fill" aria-hidden="true" />
          Progresión
        </span>
        <div className="form-grid">
          <ConfigNumber
            label="XP base por nivel"
            onChange={(levelBaseXp) =>
              patch((current) => ({ ...current, levelBaseXp }))
            }
            value={config.levelBaseXp}
          />
          <ConfigNumber
            clampMin={0}
            label="Cap de nivel (0 = sin límite)"
            onChange={(maxLevel) =>
              patch((current) => ({ ...current, maxLevel }))
            }
            value={config.maxLevel}
          />
        </div>
      </section>

      <section className="admin-group admin-group--sep">
        <span className="admin-group-head">Roles por nivel</span>
        {rules.length === 0 ? (
          <p className="admin-empty">Aún no hay roles por nivel configurados.</p>
        ) : (
          <div className="admin-list">
            {rules.map((rule) => {
              const role = guildRoles.find((entry) => entry.id === rule.roleId);
              return (
                <div className="admin-row" key={rule.level}>
                  <button
                    className="admin-row-box admin-row-main"
                    onClick={() => openEditor(rule.level)}
                    title={`Editar el nivel ${rule.level}`}
                    type="button"
                  >
                    <span className="admin-row-label">
                      Nivel <b>{rule.level}</b>
                    </span>
                    {role ? (
                      <span
                        className={roleChipClass(role)}
                        style={roleChipStyle(role)}
                      >
                        <span className="role-chip-name">{role.name}</span>
                      </span>
                    ) : (
                      <span className="admin-row-none">Sin rol</span>
                    )}
                    {rule.nicknamePrefix ? (
                      <span className="xp-rule-prefix" title="Prefijo de nombre">
                        {rule.nicknamePrefix}
                      </span>
                    ) : null}
                    <span className="admin-row-spacer" />
                    {rule.addRoleIds.length > 0 ? (
                      <span
                        className="admin-row-tag admin-row-tag--add"
                        title={`Al llegar al nivel se da${rule.addRoleIds.length === 1 ? "" : "n"} ${rule.addRoleIds.length} rol${rule.addRoleIds.length === 1 ? "" : "es"}`}
                      >
                        +{rule.addRoleIds.length}
                      </span>
                    ) : null}
                    {rule.removeRoleIds.length > 0 ? (
                      <span
                        className="admin-row-tag admin-row-tag--remove"
                        title={`Al llegar al nivel se quita${rule.removeRoleIds.length === 1 ? "" : "n"} ${rule.removeRoleIds.length} rol${rule.removeRoleIds.length === 1 ? "" : "es"}`}
                      >
                        −{rule.removeRoleIds.length}
                      </span>
                    ) : null}
                    <span className="admin-row-tag">
                      {rule.stacking === "replace" ? "Reemplaza" : "Acumula"}
                    </span>
                    <PencilSimple
                      aria-hidden="true"
                      className="admin-row-action"
                      weight="fill"
                    />
                  </button>
                  <button
                    aria-label={`Borrar el nivel ${rule.level}`}
                    className="icon-button"
                    onClick={() => removeRule(rule.level)}
                    title="Borrar el nivel"
                    type="button"
                  >
                    <Trash
                      aria-hidden="true"
                      className="icon-button-icon"
                      weight="fill"
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <button
          className="ghost-button small admin-add"
          onClick={addRule}
          type="button"
        >
          <Plus weight="bold" aria-hidden="true" />
          Agregar nivel
        </button>
      </section>

      <section className="admin-group admin-group--sep">
        <span className="admin-group-head">Multiplicadores por rol</span>
        {config.roleMultipliers.length === 0 ? (
          <p className="admin-empty">Ningún rol multiplica la XP.</p>
        ) : (
          <div className="admin-list">
            {config.roleMultipliers.map((entry) => (
              <div className="admin-row" key={entry.roleId}>
                <div className="admin-row-box">
                  <select
                    aria-label="Rol con multiplicador"
                    className="select"
                    onChange={(event) =>
                      changeMultiplierRole(entry.roleId, event.target.value)
                    }
                    value={entry.roleId}
                  >
                    <option value="">Sin rol</option>
                    {guildRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                  <label className="xp-multiplier">
                    <span>Multiplicador (x)</span>
                    <input
                      min="1"
                      onChange={(event) =>
                        updateMultiplier(
                          Number(event.target.value) || 1,
                          entry.roleId,
                        )
                      }
                      step="0.5"
                      type="number"
                      value={entry.multiplier}
                    />
                  </label>
                </div>
                <button
                  aria-label="Quitar el multiplicador"
                  className="icon-button"
                  onClick={() => removeMultiplier(entry.roleId)}
                  title="Quitar el multiplicador"
                  type="button"
                >
                  <Trash
                    aria-hidden="true"
                    className="icon-button-icon"
                    weight="fill"
                  />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          className="ghost-button small admin-add"
          onClick={addMultiplier}
          type="button"
        >
          <Plus weight="bold" aria-hidden="true" />
          Agregar multiplicador
        </button>
      </section>

      <section className="admin-group admin-group--sep">
        <span className="admin-group-head">Datos</span>
        <div className="admin-actions">
          <button
            className="ghost-button small"
            onClick={onExport}
            type="button"
          >
            <DownloadSimple aria-hidden="true" weight="fill" />
            Exportar XP
          </button>
          <button
            className="ghost-button small"
            onClick={onImport}
            type="button"
          >
            <UploadSimple aria-hidden="true" weight="fill" />
            Importar XP
          </button>
          <button
            className="ghost-button small"
            onClick={onSyncRoles}
            type="button"
          >
            <ArrowsClockwise aria-hidden="true" weight="fill" />
            Sincronizar roles con los niveles
          </button>
          <button
            className="ghost-button small danger"
            onClick={onResetAll}
            type="button"
          >
            <WarningCircle aria-hidden="true" weight="fill" />
            Resetear los niveles de todos
          </button>
        </div>
      </section>

      {dirty ? (
        <div className="admin-save">
          <button
            className="primary-button"
            disabled={savingAny}
            onClick={onSave}
            type="button"
          >
            {saving ? "Guardando…" : "Guardar configuración"}
          </button>
        </div>
      ) : null}

      {editing
        ? createPortal(
            <div
              className="modal-overlay"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  closeEditor();
                }
              }}
              role="presentation"
            >
              <div
                aria-label={`Rol del nivel ${editing.level}`}
                aria-modal="true"
                className="modal xp-rule-modal"
                role="dialog"
              >
                <header className="xp-modal-head">
                  <h4>
                    <PencilSimple weight="fill" aria-hidden="true" />
                    Nivel {editing.level}
                  </h4>
                  <button
                    aria-label="Cerrar"
                    className="icon-button"
                    onClick={closeEditor}
                    title="Cerrar"
                    type="button"
                  >
                    <X
                      aria-hidden="true"
                      className="icon-button-icon"
                      weight="bold"
                    />
                  </button>
                </header>

                <div className="form-grid">
                  <Field label="Nivel">
                    <input
                      min="0"
                      onChange={(event) =>
                        changeLevel(editing.level, Number(event.target.value))
                      }
                      type="number"
                      value={editing.level}
                    />
                  </Field>
                  <Field label="Rol del nivel">
                    <select
                      className="select"
                      onChange={(event) =>
                        patchRule(editing.level, { roleId: event.target.value })
                      }
                      value={editing.roleId}
                    >
                      <option value="">Sin rol</option>
                      {guildRoles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Prefijo de nombre">
                    <input
                      maxLength={8}
                      onChange={(event) =>
                        patchRule(editing.level, {
                          nicknamePrefix: event.target.value,
                        })
                      }
                      placeholder="🔵"
                      type="text"
                      value={editing.nicknamePrefix ?? ""}
                    />
                  </Field>
                </div>

                <div className="xp-preview">
                  <span className="admin-group-head">Así se ve el nombre</span>
                  <span
                    className="xp-preview-name"
                    style={previewStyle}
                  >{`${editing.nicknamePrefix ?? ""}${roleName(editingRole)}`}</span>
                </div>

                <div className="xp-inline-row">
                  <span className="admin-group-head">Al llegar al nivel</span>
                  <div className="xp-mode-toggle" role="group">
                    <button
                      className={editing.stacking !== "replace" ? "active" : ""}
                      onClick={() =>
                        patchRule(editing.level, { stacking: "stack" })
                      }
                      type="button"
                    >
                      Acumular
                    </button>
                    <button
                      className={editing.stacking === "replace" ? "active" : ""}
                      onClick={() =>
                        patchRule(editing.level, { stacking: "replace" })
                      }
                      type="button"
                    >
                      Reemplazar
                    </button>
                  </div>
                  <span className="xp-mode-hint">
                    {editing.stacking === "replace"
                      ? "Quita el rol de los niveles anteriores."
                      : "Suma el rol sin quitar los anteriores."}
                  </span>
                </div>

                <div className="xp-extras">
                  <div className="xp-extras-heads">
                    <button
                      aria-expanded={extrasView === "add"}
                      className={`xp-extras-head${extrasView === "add" ? " active" : ""}`}
                      onClick={() =>
                        setExtrasView(extrasView === "add" ? null : "add")
                      }
                      type="button"
                    >
                      <CaretDown aria-hidden="true" weight="bold" />
                      Roles que se dan
                      <span className="sub-card-count">
                        {editing.addRoleIds.length}
                      </span>
                    </button>
                    <button
                      aria-expanded={extrasView === "remove"}
                      className={`xp-extras-head${extrasView === "remove" ? " active" : ""}`}
                      onClick={() =>
                        setExtrasView(extrasView === "remove" ? null : "remove")
                      }
                      type="button"
                    >
                      <CaretDown aria-hidden="true" weight="bold" />
                      Roles que se quitan
                      <span className="sub-card-count">
                        {editing.removeRoleIds.length}
                      </span>
                    </button>
                  </div>
                  {extrasView ? (
                    <div className="xp-extras-body">
                      <div className="xp-role-search">
                        <MagnifyingGlass
                          aria-hidden="true"
                          className="rlb-search-icon"
                          weight="fill"
                        />
                        <input
                          aria-label="Buscar rol"
                          autoComplete="off"
                          onChange={(event) =>
                            setRoleSearch(event.target.value)
                          }
                          placeholder="Buscar rol…"
                          type="search"
                          value={roleSearch}
                        />
                      </div>
                      <div className="modal-role-list xp-role-options">
                        {extrasRoles.map((role) => {
                          const checked = extrasIds.includes(role.id);
                          return (
                            <label className="xp-role-option" key={role.id}>
                              <input
                                checked={checked}
                                onChange={(event) => {
                                  const nextIds = event.target.checked
                                    ? [...extrasIds, role.id]
                                    : extrasIds.filter((id) => id !== role.id);
                                  patchRule(
                                    editing.level,
                                    extrasView === "add"
                                      ? { addRoleIds: nextIds }
                                      : { removeRoleIds: nextIds },
                                  );
                                }}
                                type="checkbox"
                              />
                              <span
                                className={roleChipClass(role)}
                                style={roleChipStyle(role)}
                              >
                                <span className="role-chip-name">
                                  {role.name}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                        {extrasRoles.length === 0 ? (
                          <p className="admin-empty">Ningún rol coincide.</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="xp-modal-actions">
                  <button
                    className="ghost-button small danger"
                    onClick={() => removeRule(editing.level)}
                    type="button"
                  >
                    <Trash aria-hidden="true" weight="fill" />
                    Borrar nivel
                  </button>
                  <button
                    className="primary-button"
                    onClick={closeEditor}
                    type="button"
                  >
                    Listo
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
