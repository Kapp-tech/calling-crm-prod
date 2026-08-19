# DialShree post-call webhook — integration details

Everything DialShree needs in order to push call data into the Counselling CRM.
Sections 1–3 are the part to forward to them; section 4 onward is for us.

---

## 1. Endpoint

```
POST https://<crm-host>/api/webhooks/dialshree/call?token=<SHARED_SECRET>
Content-Type: application/json
```

On the current server that is:

```
POST http://13.206.157.201/api/webhooks/dialshree/call?token=<SHARED_SECRET>
```

**Authentication.** The `token` query parameter must equal the shared secret.
If DialShree can set a custom request header instead, prefer that — it keeps the
secret out of URL logs:

```
x-webhook-secret: <SHARED_SECRET>
```

Either one is accepted; the header wins if both are sent. A missing or wrong
secret returns **401** and the call is not stored.

> Treat the full URL as a credential: it carries the secret.

## 2. Expected response

On success the endpoint returns **HTTP 200** with exactly:

```json
{"status": true}
```

This matches the `api_response` / `http_status_code` fields in DialShree's own
sample, so their existing success check should pass unchanged.

| HTTP | Meaning | Should DialShree retry? |
|------|---------|-------------------------|
| 200  | Stored | No |
| 400  | Payload rejected — body is not JSON, or `phone_number` is missing/not 10 digits. The reason is in `error` | No — the payload needs fixing |
| 401  | Wrong or missing secret | No — the secret needs fixing |
| 503  | Webhook not configured on our side | Yes, later |
| 500  | Valid payload, our storage failed | **Yes** |

## 3. Payload

The body DialShree already proposed works as-is — nested `postdata`, no changes
needed:

```json
{
  "status": true,
  "http_status_code": 200,
  "postdata": {
    "call_start_time": "2026-07-13T12:18:53",
    "call_end_time": "2026-07-13T12:19:05",
    "call_duration": 12,
    "recording_url": "https://dialer26.elisiontec.com/RECORDINGS/MP3/...mp3",
    "talk_time": "00:12",
    "ring_time": "00:17",
    "phone_code": "91",
    "phone_number": "9265675019",
    "called_count": 25,
    "last_local_call_time": "2026-07-13 02:18:36",
    "agent_full_name": "Agent",
    "agent_email": "",
    "campaign": "TESTING",
    "call_type": "outbound",
    "dynamic_data": {
      "uniqueid": "1783925316.74937",
      "user": "3030",
      "entry_date": "2026-07-13 12:19:06"
    },
    "url_type": "dispo"
  }
}
```

### The two fields that matter most

| Field | Why it matters |
|---|---|
| `postdata.phone_number` | **Required.** How the call is matched to a lead. Must be the full 10-digit subscriber number; a country code prefix is tolerated and stripped |
| `postdata.dynamic_data.uniqueid` | **Strongly recommended.** Used for de-duplication — the same `uniqueid` updates the existing record instead of creating a second one, so retries are safe. Without it, a retry stores a duplicate call |
| `postdata.dynamic_data.user` | The agent's dialer seat/extension (e.g. `3030`). How the call is attributed to a counsellor — it must be the same value we send as `agent_user` on click-to-call |

Everything else is optional. Unrecognised fields are stored verbatim, so
DialShree can add fields without breaking the integration.

### Notes on formats we handle

- **Timestamps** have no timezone and are read as **IST**. Both `2026-07-13T12:18:53` and `2026-07-13 02:18:36` are accepted. If DialShree can send an explicit offset (`+05:30`) or `Z`, that is honoured and is safer.
- **`talk_time` / `ring_time`** accept `MM:SS`, `HH:MM:SS`, or a plain number of seconds.
- **`phone_code`** is reduced to digits, so a stray quote or `+` does no harm.
- A flat body without the `postdata` wrapper is also accepted.

### Confirming the URL before going live

A `GET` on the same URL with the secret returns `{"status": true, "message": ...}`.
Useful for DialShree to verify the endpoint and secret without sending a call.

---

## 4. Our side — setup

Generate the secret **on the server** (do not reuse one from a chat or ticket):

```bash
openssl rand -hex 32
```

Add it to `/home/ubuntu/app/.env.local` and restart:

```
DIALSHREE_WEBHOOK_SECRET=<the generated value>
```

```bash
pm2 restart crm
```

Until that variable is set, the endpoint returns **503** and stores nothing.

## 5. What the data feeds

| Where | What it shows |
|---|---|
| Lead drawer → **Calls** tab | Every dialer call for that lead — talk time, ring time, whether it was answered, and a link to the recording |
| **Reports** → Avg Talktime | Average minutes per *answered* call. This column previously read "no data" |
| **KPI Targets** | Three new sources: *Talk time (minutes)*, *Calls made (dialer)*, *Calls answered (dialer)* |

**Answered vs not.** The dialer reports rung-but-unanswered calls with `00:00`
talk time. Those are stored, but excluded from talk-time averages and from
*Calls answered* — including them would drag every average toward zero and make
a busy day look quiet.

**Unmatched calls are kept, not dropped.** A call whose number matches no lead,
or whose seat matches no CRM user, is still stored with the raw identity intact
and a warning in the server log. Losing real call activity would be worse than
holding a row that needs reconciling. A persistent gap means either a seat is
missing its `dialshreeId` in User Management, or a lead's number was corrected
after the call.

**One number, several leads.** If a phone belongs to more than one lead, the
call is attached to one assigned to the agent who made it, falling back to the
most recently updated lead. It never guesses across agents.
