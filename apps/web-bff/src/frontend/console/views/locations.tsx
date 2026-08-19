import type {
  ConsoleLocationDto,
  ConsoleReviewDestinationDto,
  ConsoleSettingValueDto,
  InheritedSettingDto,
} from "@review/contracts/console";
import { useState } from "react";
import { Link } from "react-router-dom";

import type { ConsoleClient } from "../console-client.js";
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
  const settings = useConsoleView({
    client,
    view: "tenant-settings",
    scope: scopeController.scope,
  });
  const command = useConsoleCommand({ client, scope: scopeController.scope });
  const [edits, setEdits] = useState<Record<string, ConsoleSettingValueDto>>({});

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
            command.mutate({ command: "save-tenant-settings", values: edits });
            setEdits({});
          }}
        >
          {settings.data.settings.map((setting) => {
            const value = edits[setting.key] ?? setting.value;
            return (
              <div className={styles.settingRow} key={setting.key}>
                <div>
                  <label htmlFor={`setting-${setting.key}`}>{setting.label}</label>
                  <p className={styles.settingSource}>
                    <OwnerBadge scope={setting.ownerScope} />
                  </p>
                </div>
                <div>
                  {setting.kind === "boolean" ? (
                    <input
                      id={`setting-${setting.key}`}
                      type="checkbox"
                      checked={value === true}
                      disabled={!setting.editable}
                      onChange={(event) =>
                        setEdits((current) => ({
                          ...current,
                          [setting.key]: event.target.checked,
                        }))
                      }
                    />
                  ) : setting.kind === "number" ? (
                    <input
                      id={`setting-${setting.key}`}
                      type="number"
                      value={Number(value)}
                      disabled={!setting.editable}
                      onChange={(event) =>
                        setEdits((current) => ({
                          ...current,
                          [setting.key]: Number(event.target.value),
                        }))
                      }
                    />
                  ) : setting.kind === "string-list" ? (
                    <input
                      id={`setting-${setting.key}`}
                      value={Array.isArray(value) ? value.join(", ") : ""}
                      disabled={!setting.editable}
                      onChange={(event) =>
                        setEdits((current) => ({
                          ...current,
                          [setting.key]: event.target.value
                            .split(",")
                            .map((term) => term.trim())
                            .filter((term) => term.length > 0),
                        }))
                      }
                    />
                  ) : (
                    <input
                      id={`setting-${setting.key}`}
                      value={String(value)}
                      disabled={!setting.editable}
                      onChange={(event) =>
                        setEdits((current) => ({
                          ...current,
                          [setting.key]: event.target.value,
                        }))
                      }
                    />
                  )}
                </div>
                <span className={styles.settingValue}>{renderValue(value)}</span>
              </div>
            );
          })}

          <h2 className={styles.sectionLabel}>Keyword categories</h2>
          <DataTable
            caption="Keyword taxonomy owned by this account"
            empty="This account has no keyword category yet."
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
            <p className={styles.buttonRow}>
              <button
                className={styles.buttonPrimary}
                type="submit"
                disabled={command.isPending || Object.keys(edits).length === 0}
              >
                Save account settings
              </button>
            </p>
          ) : null}
          <RejectionNotice error={command.error} />
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
  const command = useConsoleCommand({ client, scope: scopeController.scope });

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
      <RejectionNotice error={command.error} />

      {settings.data?.settings.map((setting) => (
        <SettingOverrideRow
          key={setting.key}
          setting={setting}
          editable={settings.data.editable}
          pending={command.isPending}
          onOverride={(value) =>
            command.mutate({
              command: "set-location-override",
              key: setting.key,
              value,
            })
          }
          onReset={() =>
            command.mutate({
              command: "reset-location-override",
              key: setting.key,
            })
          }
        />
      ))}
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
