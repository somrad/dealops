import os

# The ONLY file that decides where a deal's document BYTES actually live.
# Local dev keeps using the filesystem (backend/storage/deal_{id}/...,
# unchanged); Cloud Run sets STORAGE_BACKEND=gcs, since Cloud Run's own
# container filesystem is ephemeral and can't be trusted to keep an
# uploaded file past the current request. Every other file reads/writes
# document bytes through here — never `open()` on a deal's stored file
# directly — so this is the one place that would need to change again if
# the backend ever moved to a third storage target.

BACKEND = os.environ.get("STORAGE_BACKEND", "local")
GCS_BUCKET = os.environ.get("GCS_STORAGE_BUCKET", "dealops-app-storage")
LOCAL_ROOT = os.path.join(os.path.dirname(__file__), "storage")

_client_instance = None


def _gcs_client():
    global _client_instance
    if _client_instance is None:
        from google.cloud import storage
        _client_instance = storage.Client()
    return _client_instance


def _blob_name(deal_id: int, stored_filename: str) -> str:
    return f"deal_{deal_id}/{stored_filename}"


def _local_path(deal_id: int, stored_filename: str) -> str:
    folder = os.path.join(LOCAL_ROOT, f"deal_{deal_id}")
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, stored_filename)


def write_file(deal_id: int, stored_filename: str, content: bytes) -> None:
    if BACKEND == "gcs":
        bucket = _gcs_client().bucket(GCS_BUCKET)
        bucket.blob(_blob_name(deal_id, stored_filename)).upload_from_string(content)
    else:
        with open(_local_path(deal_id, stored_filename), "wb") as f:
            f.write(content)


def read_file(deal_id: int, stored_filename: str):
    # Returns None if the file doesn't exist — callers decide whether
    # that's a 404 or something to skip, same as the old os.path.exists()
    # checks did.
    if BACKEND == "gcs":
        blob = _gcs_client().bucket(GCS_BUCKET).blob(_blob_name(deal_id, stored_filename))
        if not blob.exists():
            return None
        return blob.download_as_bytes()
    path = _local_path(deal_id, stored_filename)
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return f.read()


def file_exists(deal_id: int, stored_filename: str) -> bool:
    if BACKEND == "gcs":
        return _gcs_client().bucket(GCS_BUCKET).blob(_blob_name(deal_id, stored_filename)).exists()
    return os.path.exists(_local_path(deal_id, stored_filename))
