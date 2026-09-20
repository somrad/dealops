import mimetypes
import os
from google.cloud import storage

# Read-only bridge to a Google Cloud Storage bucket, for the "office laptop
# has no local files to upload" workaround: documents are staged in this
# bucket from wherever the founder does have real files, then imported
# server-side from the Deal Room — never touching the browser's local file
# APIs at all. Same harness-boundary reasoning as mock_loan_iq.py: this file
# is the only place that talks to GCS.
#
# Credentials: Application Default Credentials — the VM's attached service
# account in production, whatever `gcloud auth application-default login`
# identity is active for local dev. No key file needed either way.

BUCKET_NAME = os.environ.get("GCS_IMPORT_BUCKET", "dealops-app-import")

# Constructing storage.Client() does a real credential/token lookup — a new
# one per request made the picker noticeably slow to navigate. One client,
# reused for the life of the process, same as any other SDK client in this
# codebase.
_client_instance = None


def _client():
    global _client_instance
    if _client_instance is None:
        _client_instance = storage.Client()
    return _client_instance


def list_bucket_entries(prefix: str = "") -> dict:
    # GCS has no real folders — "folders" are just "/"-delimited prefixes.
    # delimiter="/" makes the API emulate one directory level at a time:
    # matching blobs come back as files, everything past the next "/" is
    # rolled up into `iterator.prefixes` instead of being listed individually.
    # `.prefixes` is only populated once the iterator itself has been
    # consumed — the list comprehension below does that.
    client = _client()
    iterator = client.list_blobs(BUCKET_NAME, prefix=prefix, delimiter="/")
    files = [
        {"name": b.name, "size_bytes": b.size, "updated": b.updated}
        for b in iterator
        if b.name != prefix  # a folder's own placeholder object, if one exists
    ]
    folders = sorted(iterator.prefixes)
    return {"folders": folders, "files": files}


def download_bucket_file(object_name: str) -> bytes:
    bucket = _client().bucket(BUCKET_NAME)
    blob = bucket.blob(object_name)
    return blob.download_as_bytes()


def guess_content_type(object_name: str) -> str:
    return mimetypes.guess_type(object_name)[0] or "application/octet-stream"
