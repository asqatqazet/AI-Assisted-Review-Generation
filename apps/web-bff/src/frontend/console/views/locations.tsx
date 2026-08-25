import {
  ConsoleLocationOverrideChangeDtoSchema,
  ConsoleTenantSettingChangeDtoSchema,
  type ConsoleLocationDto,
  type ConsoleReviewDestinationDto,
  type ConsoleSettingValueDto,
  type InheritedSettingDto,
} from "@review/contracts/console";
import { useState } from "react";
import { Link } from "react-router-dom";

import type { ConsoleClient } from "../console-client.js";
import {
  ConfigurationDraftPanel,
  tenantConfigurationScope,
  useConfigurationDraftController,
} from "../configuration-draft-panel.js";
import { useConsoleCommand, useConsoleView } from "../console-queries.js";
import {
  DataTable,
  EmptyState,
  OwnerBadge,
  QueryState,
  RejectionNotice,
  ViewHeader,
  scopeLabel,
} from "../console-ui.js";
import styles from "../operator-console.module.css";
import type { ConsoleScopeController } from "../use-console-scope.js";

const emptyAddress = {
  line1: "",
  line2: "",
  postalCode: "",
  city: "",
  country: "",
};

type Address = typeof emptyAddress;

function AddressFields({
  address,
  disabled,
  onChange,
}: {
  readonly address: Address;
  readonly disabled: boolean;
  readonly onChange: (next: Address) => void;
}): React.JSX.Element {
  const field = (
    key: keyof Address,
    label: string,
    extra: { readonly maxLength?: number } = {},
  ): React.JSX.Element => (
    <label className={styles.field} key={key}>
      {label}
      <input
        value={address[key]}
        disabled={disabled}
        maxLength={extra.maxLength ?? 200}
        onChange={(event) => onChange({ ...address, [key]: event.target.value })}
      />
    </label>
  );
  return (
    <div className={styles.formRow}>
      {field("line1", "Address line 1")}
      {field("line2", "Address line 2")}
      {field("postalCode", "Postcode", { maxLength: 20 })}
      {field("city", "City", { maxLength: 120 })}
      {field("country", "Country code", { maxLength: 2 })}
    </div>
  );
}

/** Keeps a long form readable without inventing an order of its own. */
function groupSettings<T extends { readonly group: string }>(
  settings: readonly T[],
): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const setting of settings) {
    groups.set(setting.group, [...(groups.get(setting.group) ?? []), setting]);
  }
  return [...groups.entries()];
}

const LOCALE_OPTIONS = ["en-GB", "de-DE"] as const;
const ENTRY_MODE_OPTIONS = ["invite", "open-qr", "both"] as const;

/**
 * A setting is edited with the control its kind implies: a locale and an entry
 * mode are closed sets, so they are chosen rather than typed.
 */
function SettingControl({
  id,
  kind,
  value,
  editable,
  onChange,
}: {
  readonly id: string;
  readonly kind: string;
  readonly value: ConsoleSettingValueDto;
  readonly editable: boolean;
  readonly onChange: (next: ConsoleSettingValueDto) => void;
}): React.JSX.Element {
  if (kind === "locale" || kind === "entry-mode") {
    const options = kind === "locale" ? LOCALE_OPTIONS : ENTRY_MODE_OPTIONS;
    return (
      <select
        id={id}
        className={styles.settingControl}
        value={String(value)}
        disabled={!editable}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (kind === "boolean") {
    return (
      <span className={styles.settingToggle}>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          disabled={!editable}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className={styles.settingSource}>{value === true ? "ON" : "OFF"}</span>
      </span>
    );
  }
  if (kind === "money-micros") {
    // Stored in micros; an operator thinks in whole currency units.
    return (
      <span className={styles.settingToggle}>
        <input
          id={id}
          className={styles.settingControl}
          type="number"
          min={0}
          step="0.01"
          value={Number(value) / 1_000_000}
          disabled={!editable}
          onChange={(event) =>
            onChange(Math.round(Number(event.target.value) * 1_000_000))
          }
        />
        <span className={styles.settingSource}>per month</span>
      </span>
    );
  }
  if (kind === "percent") {
    return (
      <span className={styles.settingToggle}>
        <input
          id={id}
          className={styles.settingControl}
          type="number"
          min={1}
          max={100}
          value={Number(value)}
          disabled={!editable}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className={styles.settingSource}>% of budget</span>
      </span>
    );
  }
  if (kind === "number") {
    return (
      <input
        id={id}
        className={styles.settingControl}
        type="number"
        min={0}
        value={Number(value)}
        disabled={!editable}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    );
  }
  if (kind === "string-list") {
    return (
      <input
        id={id}
        className={styles.settingControl}
        placeholder="Comma separated"
        value={Array.isArray(value) ? value.join(", ") : ""}
        disabled={!editable}
        onChange={(event) =>
          onChange(
            event.target.value
              .split(",")
              .map((term) => term.trim())
              .filter((term) => term.length > 0),
          )
        }
      />
    );
  }
  if (kind === "text") {
    return (
      <textarea
        id={id}
        className={styles.settingTextarea}
        value={String(value)}
        disabled={!editable}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <input
      id={id}
      className={styles.settingControl}
      value={String(value)}
      disabled={!editable}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function renderValue(value: ConsoleSettingValueDto): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? "—" : value.join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "ON" : "OFF";
  }
  return String(value);
}

export function LocationsView({
  client,
  scopeController,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const locations = useConsoleView({
    client,
    view: "locations",
    scope: scopeController.scope,
  });
  const command = useConsoleCommand({ client, scope: scopeController.scope });
  const [draft, setDraft] = useState({
    name: "",
    slug: "",
    address: emptyAddress,
  });
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <>
      <ViewHeader
        eyebrow="Account"
        title="Locations"
        meta={
          locations.data === undefined
            ? undefined
            : scopeLabel(locations.data.scope)
        }
      />
      <QueryState query={locations} label="locations" />

      {locations.data === undefined ? null : (
        <>
          {locations.data.editable ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                command.mutate({
                  command: "create-location",
                  name: draft.name,
                  slug: draft.slug,
                  address: draft.address,
                  entryMode: null,
                });
                setDraft({ name: "", slug: "", address: emptyAddress });
              }}
            >
              <h2 className={styles.sectionLabel}>Add a Location</h2>
              <div className={styles.formRow}>
                <label className={styles.field}>
                  Name
                  <input
                    value={draft.name}
                    required
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={styles.field}>
                  Slug
                  <input
                    value={draft.slug}
                    required
                    pattern="[a-z0-9-]+"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        slug: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <AddressFields
                address={draft.address}
                disabled={command.isPending}
                onChange={(address) =>
                  setDraft((current) => ({ ...current, address }))
                }
              />
              <p className={styles.buttonRow}>
                <button
                  className={styles.buttonPrimary}
                  type="submit"
                  disabled={command.isPending}
                >
                  Add Location
                </button>
              </p>
              <RejectionNotice error={command.error} />
            </form>
          ) : null}

          <DataTable
            caption="Locations in this account"
            empty="This account has no Location yet."
            rows={locations.data.locations}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "name",
                header: "Location",
                rowHeader: true,
                render: (row) => row.name,
              },
              {
                key: "slug",
                header: "Slug",
                render: (row) => <span className={styles.mono}>{row.slug}</span>,
              },
              {
                key: "entryMode",
                header: "Entry mode",
                render: (row) => (
                  <>
                    {row.entryMode} <OwnerBadge scope={row.entryModeSource} />
                  </>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (row) => (row.active ? "active" : "inactive"),
              },
              {
                key: "links",
                header: "Configure",
                render: (row) => (
                  <span className={styles.buttonRow}>
                    <Link
                      to={scopeController.href(
                        `/console/locations/${row.id}/settings`,
                        { locationId: row.id },
                      )}
                    >
                      Settings
                    </Link>
                    <Link
                      to={scopeController.href(
                        `/console/locations/${row.id}/distribution`,
                        { locationId: row.id },
                      )}
                    >
                      Distribution
                    </Link>
                  </span>
                ),
              },
              {
                key: "activation",
                header: "",
                render: (row) =>
                  locations.data.editable ? (
                    <span className={styles.buttonRow}>
                      <button
                        type="button"
                        className={styles.button}
                        onClick={() =>
                          setEditing((current) =>
                            current === row.id ? null : row.id,
                          )
                        }
                      >
                        {editing === row.id ? "Close" : "Edit"}
                      </button>
                      <button
                        type="button"
                        className={styles.button}
                        disabled={command.isPending}
                        onClick={() =>
                          command.mutate({
                            command: "update-location",
                            locationId: row.id,
                            name: row.name,
                            address: row.address,
                            active: !row.active,
                          })
                        }
                      >
                        {row.active ? "Deactivate" : "Activate"}
                      </button>
                    </span>
                  ) : null,
              },
            ]}
          />

          {editing === null
            ? null
            : locations.data.locations
                .filter((location) => location.id === editing)
                .map((location) => (
                  <LocationEditor
                    key={location.id}
                    location={location}
                    pending={command.isPending}
                    onSave={(next) => {
                      command.mutate({
                        command: "update-location",
                        locationId: location.id,
                        name: next.name,
                        address: next.address,
                        active: location.active,
                      });
                      setEditing(null);
                    }}
                  />
                ))}
        </>
      )}
    </>
  );
}

function LocationEditor({
  location,
  pending,
  onSave,
}: {
  readonly location: ConsoleLocationDto;
  readonly pending: boolean;
  readonly onSave: (next: {
    readonly name: string;
    readonly address: Address;
  }) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState({
    name: location.name,
    address: location.address,
  });

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <h2 className={styles.sectionLabel}>Edit {location.name}</h2>
      <label className={styles.field}>
        Name
        <input
          required
          value={draft.name}
          onChange={(event) =>
            setDraft((current) => ({ ...current, name: event.target.value }))
          }
        />
      </label>
      <AddressFields
        address={draft.address}
        disabled={pending}
        onChange={(address) => setDraft((current) => ({ ...current, address }))}
      />
      <p className={styles.buttonRow}>
        <button className={styles.buttonPrimary} type="submit" disabled={pending}>
          Save Location
        </button>
      </p>
    </form>
  );
}

export function TenantSettingsView({
  client,
  scopeController,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const configurationScope = tenantConfigurationScope(scopeController.scope);
  const settings = useConsoleView({
    client,
    view: "tenant-settings",
    scope: configurationScope,
  });
  const categoryCommand = useConsoleCommand({
    client,
    scope: configurationScope,
  });
  const draftController = useConfigurationDraftController({
    client,
    scope: configurationScope,
    configuration: settings.data?.configuration,
  });
  const [edits, setEdits] = useState<Record<string, ConsoleSettingValueDto>>({});
  const [category, setCategory] = useState({ key: "", label: "" });

  return (
    <>
      <ViewHeader
        eyebrow="Account"
        title="Account settings"
        meta="Every field below is owned by the account"
      />
      <QueryState query={settings} label="account settings" />

      {settings.data === undefined ? null : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            draftController.stage(
              Object.entries(edits).map(([key, value]) =>
                ConsoleTenantSettingChangeDtoSchema.parse({ key, value }),
              ),
              { onSuccess: () => setEdits({}) },
            );
          }}
        >
          {groupSettings(settings.data.settings).map(([group, rows]) => (
            <section key={group}>
              <h2 className={styles.sectionLabel}>{group}</h2>
              {rows.map((setting) => {
                const value = edits[setting.key] ?? setting.value;
                return (
                  <div className={styles.settingRow} key={setting.key}>
                    <div>
                      <label htmlFor={`setting-${setting.key}`}>
                        {setting.label}
                      </label>
                      <p className={styles.settingHelp}>{setting.description}</p>
                      <p className={styles.settingSource}>
                        <OwnerBadge scope={setting.ownerScope} />
                      </p>
                    </div>
                    <SettingControl
                      id={`setting-${setting.key}`}
                      kind={setting.kind}
                      value={value}
                      editable={setting.editable}
                      onChange={(next) =>
                        setEdits((current) => ({
                          ...current,
                          [setting.key]: next,
                        }))
                      }
                    />
                  </div>
                );
              })}
            </section>
          ))}

          {settings.data.editable ? (
            <p className={styles.buttonRow}>
              <button
                className={styles.buttonPrimary}
                type="submit"
                disabled={
                  draftController.isPending || Object.keys(edits).length === 0
                }
              >
                Stage account settings
              </button>
              {Object.keys(edits).length === 0 ? (
                <span className={styles.settingSource}>No unsaved changes.</span>
              ) : (
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => setEdits({})}
                >
                  Discard changes
                </button>
              )}
            </p>
          ) : null}
          <ConfigurationDraftPanel
            configuration={settings.data.configuration}
            controller={draftController}
            editable={settings.data.editable}
            scopeKind="tenant"
          />

          <h2 className={styles.sectionLabel}>Fact option categories</h2>
          <p className={styles.emptyCopy}>
            How fact options are grouped for a reviewer. Adding one is a data
            change; it needs no release.
          </p>
          <DataTable
            caption="Fact option taxonomy owned by this account"
            empty="This account has no category yet, so fact options cannot be grouped."
            rows={settings.data.keywordCategories}
            rowKey={(row) => row.key}
            columns={[
              { key: "label", header: "Category", rowHeader: true, render: (row) => row.label },
              {
                key: "key",
                header: "Key",
                render: (row) => <span className={styles.mono}>{row.key}</span>,
              },
              { key: "order", header: "Order", render: (row) => row.sortOrder },
            ]}
          />

          {settings.data.editable ? (
            <div className={styles.formRow}>
              <label className={styles.field}>
                New category label
                <input
                  value={category.label}
                  onChange={(event) =>
                    setCategory((current) => ({
                      ...current,
                      label: event.target.value,
                    }))
                  }
                />
              </label>
              <label className={styles.field}>
                Key
                <input
                  value={category.key}
                  pattern="[a-z0-9-]+"
                  onChange={(event) =>
                    setCategory((current) => ({
                      ...current,
                      key: event.target.value,
                    }))
                  }
                />
              </label>
              <button
                type="button"
                className={styles.button}
                disabled={
                  categoryCommand.isPending ||
                  category.key.trim() === "" ||
                  category.label.trim() === ""
                }
                onClick={() => {
                  categoryCommand.mutate({
                    command: "create-keyword-category",
                    key: category.key,
                    label: category.label,
                  });
                  setCategory({ key: "", label: "" });
                }}
              >
              Add category
              </button>
            </div>
          ) : null}
          <RejectionNotice error={categoryCommand.error} />

        </form>
      )}
    </>
  );
}

function SettingOverrideRow({
  setting,
  editable,
  pending,
  onOverride,
  onReset,
}: {
  readonly setting: InheritedSettingDto;
  readonly editable: boolean;
  readonly pending: boolean;
  readonly onOverride: (value: ConsoleSettingValueDto) => void;
  readonly onReset: () => void;
}): React.JSX.Element {
  const overridden = setting.source === "location";
  return (
    <div className={styles.settingRow}>
      <div>
        <span>{setting.label}</span>
        <p className={styles.settingSource}>
          {overridden ? "Location override" : "Inherited from account"}{" "}
          <OwnerBadge scope={overridden ? "location" : "tenant"} />
        </p>
      </div>
      <span className={styles.settingValue}>
        {renderValue(setting.effectiveValue)}
      </span>
      <span className={styles.buttonRow}>
        {!setting.overridable ? (
          <span className={styles.settingSource}>Account-wide only</span>
        ) : overridden ? (
          <button
            type="button"
            className={styles.button}
            disabled={!editable || pending}
            onClick={onReset}
          >
            Reset to account value
          </button>
        ) : (
          <button
            type="button"
            className={styles.button}
            disabled={!editable || pending}
            onClick={() =>
              onOverride(
                typeof setting.effectiveValue === "boolean"
                  ? !setting.effectiveValue
                  : setting.effectiveValue,
              )
            }
          >
            Override
          </button>
        )}
      </span>
    </div>
  );
}

export function LocationSettingsView({
  client,
  scopeController,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const settings = useConsoleView({
    client,
    view: "location-settings",
    scope: scopeController.scope,
    enabled: scopeController.scope.locationId !== null,
  });
  const draftController = useConfigurationDraftController({
    client,
    scope: scopeController.scope,
    configuration: settings.data?.configuration,
  });

  if (scopeController.scope.locationId === null) {
    return (
      <>
        <ViewHeader eyebrow="Location" title="Location settings" />
        <EmptyState>Select a Location to see its settings.</EmptyState>
      </>
    );
  }

  return (
    <>
      <ViewHeader
        eyebrow="Location"
        title="Location settings"
        meta={
          settings.data === undefined
            ? undefined
            : scopeLabel(settings.data.scope)
        }
      />
      <QueryState query={settings} label="location settings" />

      {settings.data?.settings.map((setting) => (
        <SettingOverrideRow
          key={setting.key}
          setting={setting}
          editable={settings.data.editable}
          pending={draftController.isPending}
          onOverride={(value) =>
            draftController.stage([
              {
                operation: "set-location-override",
                change: ConsoleLocationOverrideChangeDtoSchema.parse({
                  key: setting.key,
                  value,
                }),
              },
            ])
          }
          onReset={() =>
            draftController.stage([
              {
                operation: "reset-location-override",
                key: setting.key,
              },
            ])
          }
        />
      ))}
      {settings.data === undefined ? null : (
        <ConfigurationDraftPanel
          configuration={settings.data.configuration}
          controller={draftController}
          editable={settings.data.editable}
          scopeKind="location"
        />
      )}
    </>
  );
}

function DestinationEditor({
  destination,
  editable,
  pending,
  onSave,
}: {
  readonly destination: ConsoleReviewDestinationDto;
  readonly editable: boolean;
  readonly pending: boolean;
  readonly onSave: (next: {
    readonly platformPlaceId: string;
    readonly targetUrl: string;
    readonly enabled: boolean;
  }) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState({
    platformPlaceId: destination.platformPlaceId,
    targetUrl: destination.targetUrl,
    enabled: destination.enabled,
  });

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <h3 className={styles.sectionLabel}>
        {destination.displayName}{" "}
        <span
          className={
            destination.configurationState === "valid"
              ? styles.statusPass
              : styles.statusFail
          }
        >
          {destination.configurationState}
        </span>
      </h3>
      <div className={styles.formRow}>
        <label className={styles.field}>
          Place identifier
          <input
            value={draft.platformPlaceId}
            disabled={!editable}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                platformPlaceId: event.target.value,
              }))
            }
          />
        </label>
        <label className={styles.field}>
          Review link
          <input
            type="url"
            placeholder="https://"
            value={draft.targetUrl}
            disabled={!editable}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                targetUrl: event.target.value,
              }))
            }
          />
        </label>
        <label className={styles.field}>
          Enabled
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={!editable}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
          />
        </label>
        {editable ? (
          <button className={styles.buttonPrimary} type="submit" disabled={pending}>
            Save destination
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function DistributionView({
  client,
  scopeController,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const distribution = useConsoleView({
    client,
    view: "distribution",
    scope: scopeController.scope,
    enabled: scopeController.scope.locationId !== null,
  });
  const destinations = useConsoleView({
    client,
    view: "destinations",
    scope: scopeController.scope,
    enabled: scopeController.scope.locationId !== null,
  });
  const command = useConsoleCommand({ client, scope: scopeController.scope });
  const [copied, setCopied] = useState(false);

  if (scopeController.scope.locationId === null) {
    return (
      <>
        <ViewHeader eyebrow="Location" title="Distribution" />
        <EmptyState>Select a Location to see its distribution assets.</EmptyState>
      </>
    );
  }

  return (
    <>
      <ViewHeader
        eyebrow="Location"
        title="Distribution"
        meta={
          distribution.data === undefined
            ? undefined
            : scopeLabel(distribution.data.scope)
        }
      />
      <QueryState query={distribution} label="distribution" />

      <p className={styles.emptyCopy}>
        Reviewers are served the immutable configuration published from the
        Tenant or Location Draft. Stage, inspect and publish configuration from
        the corresponding settings screen.
      </p>

      {distribution.data === undefined ? null : (
        <>
          <dl className={styles.detailList}>
            <dt>Live survey URL</dt>
            <dd>
              <span className={styles.mono}>{distribution.data.liveUrl}</span>
            </dd>
            <dt>Entry mode</dt>
            <dd>
              {distribution.data.entryMode} —{" "}
              {distribution.data.verifiesVisit
                ? "an invitation is required, so a review follows a recorded visit"
                : "anyone who scans can start, so a visit is not verified"}
            </dd>
            <dt>Issued</dt>
            <dd>{distribution.data.counters.issued}</dd>
            <dt>Opened</dt>
            <dd>{distribution.data.counters.opened}</dd>
            <dt>Completed</dt>
            <dd>{distribution.data.counters.completed}</dd>
          </dl>

          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(distribution.data.liveUrl)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              Copy survey URL
            </button>
            {distribution.data.qrSvg === null ? null : (
              <a
                className={styles.button}
                download="survey-qr.svg"
                href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(distribution.data.qrSvg)}`}
              >
                Download QR (SVG)
              </a>
            )}
          </div>
          {copied ? <p role="status">Survey URL copied.</p> : null}

          <h2 className={styles.sectionLabel}>QR code</h2>
          {distribution.data.qrSvg === null ? (
            <p className={styles.alert} role="status">
              {distribution.data.qrUnavailableReason ??
                "No QR code is available for this venue."}
            </p>
          ) : (
            <div
              className={styles.qr}
              aria-label="QR code for the location survey URL"
              // Generated by the server from the real survey URL.
              dangerouslySetInnerHTML={{ __html: distribution.data.qrSvg }}
            />
          )}

          <h2 className={styles.sectionLabel}>Invitation copy</h2>
          <p>{distribution.data.invitationTemplate}</p>
          <h2 className={styles.sectionLabel}>Table QR copy</h2>
          <p>{distribution.data.tableQrCopy}</p>
        </>
      )}

      <h2 className={styles.sectionLabel}>Review destinations</h2>
      <p className={styles.emptyCopy}>
        Where a reviewer is sent after drafting. The identifier belongs to this
        venue, so two venues of the same account can point at different
        listings.
      </p>
      <QueryState query={destinations} label="review destinations" />
      <RejectionNotice error={command.error} />
      {destinations.data === undefined ? null : destinations.data.destinations.length === 0 ? (
        <EmptyState>
          No review platform is available for this account yet.
        </EmptyState>
      ) : (
        destinations.data.destinations.map((destination) => (
          <DestinationEditor
            key={destination.destinationTypeId}
            destination={destination}
            editable={destinations.data.editable}
            pending={command.isPending}
            onSave={(next) =>
              command.mutate({
                command: "save-destination",
                destinationTypeId: destination.destinationTypeId,
                platformPlaceId: next.platformPlaceId,
                targetUrl: next.targetUrl,
                enabled: next.enabled,
              })
            }
          />
        ))
      )}
    </>
  );
}
