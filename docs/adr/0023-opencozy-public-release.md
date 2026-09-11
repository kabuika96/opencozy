# ADR 0023: Opencozy public release and compatibility

## Status

Accepted

## Context

The application previously called LiteHarness is published as Opencozy. Existing installations contain persisted history, device state, runtime tool identifiers, launchd services, and configuration using the previous name. A branding release must not reset that state or interrupt running work.

## Decision

Use Opencozy for public product text, repository documentation, and npm workspace names (`@opencozy/backend` and `@opencozy/frontend`). Publish the source under the MIT License.

Retain existing `LITEHARNESS_*` environment variables, `liteharness` protocol/tool identifiers, storage keys, database defaults, service labels, and compatibility script filenames. Existing tool definitions in persisted Codex Threads remain valid. Do not migrate or clear user data merely to rename the product. Runtime identifiers in historical ADRs refer to these compatibility contracts.

The public source tree excludes local credentials, application data, private machine paths, and external personal skill inventories. Public contributors use the documented environment example and normal npm workspace commands.

## Consequences

The public name and certain technical identifiers differ intentionally. Future identifier migrations need their own compatibility plan and tests. Renaming source does not rename or restart an existing deployment; activating backend changes still requires an approved restart and interrupts active Runs.
