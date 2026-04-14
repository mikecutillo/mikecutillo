"""
spotify_restore.py

Scans ~/OneDrive/Music for artist/album folders and creates a Spotify
playlist with every album found. Skips folders it can't match.

Setup (one-time):
  1. Go to https://developer.spotify.com/dashboard
  2. Create an app — any name works
  3. Add redirect URI: http://localhost:8888/callback
  4. Copy Client ID and Client Secret
  5. Set env vars or paste them when prompted:
       export SPOTIPY_CLIENT_ID=xxx
       export SPOTIPY_CLIENT_SECRET=yyy

Then run:
  python spotify_restore.py
"""

import os
import re
import sys
import time
from pathlib import Path

import spotipy
from spotipy.oauth2 import SpotifyOAuth

# ── config ────────────────────────────────────────────────────────────────────

MUSIC_ROOT = Path.home() / "OneDrive" / "Music"
PLAYLIST_NAME = "Recovered Library"
REDIRECT_URI = "http://localhost:8888/callback"
SCOPE = "playlist-modify-private playlist-modify-public"

# How long to sleep between Spotify API searches (seconds) to avoid rate limits
SEARCH_DELAY = 0.2

# ── album name cleaner ────────────────────────────────────────────────────────

# Patterns to strip from folder names before searching Spotify
_NOISE = re.compile(
    r"""
    \(?\b(
        FLAC | MP3 | V0 | V2 | 320 | 128 | 256 | 192 |
        WEB | CDQ | Advance | Bonus.Disc.Version |
        Remaster(?:ed)? | Deluxe | Limited | Special.Edition |
        Retail | Promo | VBR | CBR | LAME |
        \d{4}           # standalone year like 2009
    )\b\)?
    """,
    re.IGNORECASE | re.VERBOSE,
)
_SEPARATORS = re.compile(r"[-_]+")
_EXTRA_SPACES = re.compile(r"\s{2,}")
_BRACKETS = re.compile(r"[\[\]()]")
_RELEASE_TAGS = re.compile(
    r"-[A-Z0-9]{3,12}$"  # trailing scene tags like -KOUALA, -ENTiTLED
)


def clean_name(raw: str) -> str:
    s = raw
    s = _RELEASE_TAGS.sub("", s)
    s = _NOISE.sub(" ", s)
    s = _BRACKETS.sub(" ", s)
    s = _SEPARATORS.sub(" ", s)
    s = _EXTRA_SPACES.sub(" ", s)
    return s.strip()


def strip_artist_prefix(artist: str, album_raw: str) -> str:
    """Remove leading 'Artist - ' prefix from album folder names."""
    prefix = re.escape(artist)
    cleaned = re.sub(rf"^{prefix}\s*[-–]\s*", "", album_raw, flags=re.IGNORECASE)
    return cleaned


# ── folder scanner ────────────────────────────────────────────────────────────

def scan_library(root: Path) -> list[tuple[str, str]]:
    """
    Returns a list of (artist, album_search_name) tuples.
    Only looks 2 levels deep: root/Artist/Album
    """
    pairs = []
    for artist_dir in sorted(root.iterdir()):
        if not artist_dir.is_dir():
            continue
        artist = artist_dir.name
        # Skip junk top-level folders
        if artist.startswith("!!!") or artist in {"26", "FLAC", "Xbox Music",
                                                   "Audio Books", "Comedy",
                                                   "Christmas", "Halloween",
                                                   "Disco", "Techno", "Lounge",
                                                   "Disney", "Classical",
                                                   "Soundtracks", "Theme",
                                                   "Nature", "Pranks", "Data"}:
            continue
        album_dirs = [d for d in artist_dir.iterdir() if d.is_dir()]
        if album_dirs:
            for album_dir in album_dirs:
                raw = album_dir.name
                raw = strip_artist_prefix(artist, raw)
                album = clean_name(raw)
                if album:
                    pairs.append((artist, album))
        else:
            # Artist folder with no sub-albums — just search by artist
            pairs.append((artist, ""))
    return pairs


# ── spotify helpers ───────────────────────────────────────────────────────────

def get_spotify() -> spotipy.Spotify:
    client_id = os.environ.get("SPOTIPY_CLIENT_ID") or input("Spotify Client ID: ").strip()
    client_secret = os.environ.get("SPOTIPY_CLIENT_SECRET") or input("Spotify Client Secret: ").strip()
    return spotipy.Spotify(
        auth_manager=SpotifyOAuth(
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=REDIRECT_URI,
            scope=SCOPE,
            open_browser=True,
            cache_path=".spotify_token_cache",
        )
    )


def find_album_tracks(sp: spotipy.Spotify, artist: str, album: str) -> list[str]:
    """Search for an album and return a list of track URIs."""
    query = f'album:"{album}" artist:"{artist}"' if album else f'artist:"{artist}"'
    try:
        results = sp.search(q=query, type="album", limit=1)
        items = results.get("albums", {}).get("items", [])
        if not items:
            # Fallback: looser search
            query2 = f"{album} {artist}" if album else artist
            results = sp.search(q=query2, type="album", limit=1)
            items = results.get("albums", {}).get("items", [])
        if not items:
            return []
        album_id = items[0]["id"]
        tracks_data = sp.album_tracks(album_id, limit=50)
        return [t["uri"] for t in tracks_data.get("items", []) if t]
    except Exception as e:
        print(f"    ⚠  Search error for {artist} / {album}: {e}")
        return []


def add_tracks_to_playlist(sp: spotipy.Spotify, playlist_id: str, uris: list[str]):
    """Add track URIs in batches of 100."""
    for i in range(0, len(uris), 100):
        batch = uris[i : i + 100]
        sp.playlist_add_items(playlist_id, batch)


def create_or_get_playlist(sp: spotipy.Spotify, user_id: str) -> str:
    """Return ID of existing 'Recovered Library' playlist or create a new one."""
    playlists = sp.user_playlists(user_id, limit=50)
    for pl in playlists.get("items", []):
        if pl and pl.get("name") == PLAYLIST_NAME:
            print(f"Found existing playlist '{PLAYLIST_NAME}' — adding to it.")
            return pl["id"]
    pl = sp.user_playlist_create(
        user_id,
        PLAYLIST_NAME,
        public=False,
        description="Recovered from OneDrive folder structure via spotify_restore.py",
    )
    print(f"Created new playlist '{PLAYLIST_NAME}'.")
    return pl["id"]


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    if not MUSIC_ROOT.exists():
        print(f"Music folder not found: {MUSIC_ROOT}")
        sys.exit(1)

    print("Scanning OneDrive Music folder structure...")
    pairs = scan_library(MUSIC_ROOT)
    print(f"Found {len(pairs)} artist/album entries to search.\n")

    print("Connecting to Spotify...")
    sp = get_spotify()
    user_id = sp.current_user()["id"]
    print(f"Logged in as: {user_id}\n")

    playlist_id = create_or_get_playlist(sp, user_id)
    print()

    all_uris: list[str] = []
    not_found: list[tuple[str, str]] = []

    for i, (artist, album) in enumerate(pairs, 1):
        label = f"{artist} — {album}" if album else artist
        print(f"[{i}/{len(pairs)}] {label}", end="", flush=True)
        uris = find_album_tracks(sp, artist, album)
        if uris:
            all_uris.extend(uris)
            print(f"  ✓ {len(uris)} tracks")
        else:
            not_found.append((artist, album))
            print("  ✗ not found")
        time.sleep(SEARCH_DELAY)

    print(f"\nAdding {len(all_uris)} tracks to playlist in batches...")
    add_tracks_to_playlist(sp, playlist_id, all_uris)

    print(f"\nDone! Playlist '{PLAYLIST_NAME}' has {len(all_uris)} tracks.")
    print(f"Matched: {len(pairs) - len(not_found)}/{len(pairs)} albums")

    if not_found:
        log_path = Path("spotify_not_found.txt")
        with log_path.open("w") as f:
            for artist, album in not_found:
                f.write(f"{artist} — {album}\n")
        print(f"\n{len(not_found)} albums not found on Spotify → logged to {log_path}")


if __name__ == "__main__":
    main()
