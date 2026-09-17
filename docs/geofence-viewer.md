# Geofence viewer

Open `/geofences` in the Ops dashboard. The admin-only viewer reads the configured Data-FM FMS account and shows its geofence catalog, supported boundaries on Google Maps, selected record details, and redacted source JSON. Search and filters affect the map and catalog; Download all JSON exports the entire fetched snapshot. Catalog pagination does not limit the map or export.

## Server configuration

Configure the process handling `GET /api/admin/gateway/geofences`. For the normal Next.js API this is the web process; when `SONGDEE_API_URL` points to a separate backend, configure that backend instead. Restart the API process after changing its environment.

For the Data-FM FMS web portal, set all three private variables:

```dotenv
SONGDEE_FMS_BASE_URL=https://www.data-fm.com/SDFMSV20/
SONGDEE_FMS_USERNAME=your-web-account
SONGDEE_FMS_PASSWORD=your-web-password
```

The web login and API are two access methods for Data-FM FMS. A complete web login configuration takes precedence. The adapter signs in to the portal, reads geofence module 10, and follows its same-origin list/header read links. It never saves, deletes, or imports geofences. These web credentials may differ from the existing Data-FM API credentials.

Without a complete FMS configuration, the adapter uses the existing private Data-FM variables:

```dotenv
SONGDEE_DATA_FM_BASE_URL=https://www.data-fm.com
SONGDEE_DATA_FM_USERNAME=your-api-account
SONGDEE_DATA_FM_PASSWORD=your-api-password
```

This path calls `GetToken` and then `GetGeofenceInfo` with `jtoken`. A successful vehicle/GPS connection does not establish access to geofences. In particular, Data-FM response code 4 is reported as an upstream error, not an empty geofence catalog. The viewer reports unavailable or incomplete coverage explicitly.

The web process needs `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. This is the browser Maps key; restrict its allowed website origins in Google Cloud. The viewer has no connection to Spark geofence tables or APIs. FMS passwords, session cookies, and API tokens remain on the backend and are redacted from exported records.

## Data interpretation

Complete successful snapshots are cached for 60 seconds; refresh uses that cache while it is fresh. Failed logins pause further login attempts for three minutes. This is an on-demand viewer, with no background collector or automatic job transitions.

Every source record is retained, including records with unsupported or invalid geometry. Circles, explicit GeoJSON, and paths with named latitude/longitude fields can be mapped. Unlabelled coordinate pairs and unknown vendor shape encodings remain visible as raw JSON until their format is verified. A missing boundary on the map therefore does not mean a missing source record. Source completeness refers to the records returned to the configured account, not access to other accounts.

## Verification

Run the focused adapter tests with `node --test tests/geofence-source.test.mjs`. Browser checks should cover admin protection, connection failures, all-record export under an active filter, pagination, shape selection, and mobile layout. Fixture checks establish viewer behavior only; confirm the live source separately before claiming actual geofence coverage.
