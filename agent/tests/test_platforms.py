"""Tests for platform client classes."""
import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Import and instantiation tests
# ---------------------------------------------------------------------------

PLATFORM_CLASSES = {
    "tinder": ("clapcheeks.platforms.tinder", "TinderClient", {"driver": MagicMock()}),
    "bumble": ("clapcheeks.platforms.bumble", "BumbleClient", {"driver": MagicMock()}),
    "hinge": ("clapcheeks.platforms.hinge", "HingeClient", {"driver": MagicMock()}),
    "grindr": ("clapcheeks.platforms.grindr", "GrindrClient", {}),
    "badoo": ("clapcheeks.platforms.badoo", "BadooClient", {"driver": MagicMock()}),
    "happn": ("clapcheeks.platforms.happn", "HappnClient", {}),
    "okcupid": ("clapcheeks.platforms.okcupid", "OKCupidClient", {}),
    "pof": ("clapcheeks.platforms.pof", "POFClient", {"driver": MagicMock()}),
    "feeld": ("clapcheeks.platforms.feeld", "FeeldClient", {}),
    "cmb": ("clapcheeks.platforms.coffeemeetsbagel", "CMBClient", {}),
}


@pytest.mark.parametrize("platform", PLATFORM_CLASSES.keys())
def test_import_and_instantiate(platform):
    """Each platform client can be imported and instantiated."""
    import importlib
    module_name, class_name, kwargs = PLATFORM_CLASSES[platform]
    mod = importlib.import_module(module_name)
    cls = getattr(mod, class_name)
    instance = cls(**kwargs)
    assert instance is not None


@pytest.mark.parametrize("platform", PLATFORM_CLASSES.keys())
def test_has_run_swipe_session(platform):
    """Every platform client must have run_swipe_session."""
    import importlib
    module_name, class_name, kwargs = PLATFORM_CLASSES[platform]
    mod = importlib.import_module(module_name)
    cls = getattr(mod, class_name)
    instance = cls(**kwargs)
    assert hasattr(instance, "run_swipe_session"), f"{class_name} missing run_swipe_session"


# Platforms that implement the full messaging interface (check_new_matches + send_message)
MESSAGING_PLATFORMS = ["tinder", "grindr", "badoo", "happn", "okcupid", "pof", "feeld", "cmb"]


@pytest.mark.parametrize("platform", MESSAGING_PLATFORMS)
def test_has_messaging_interface(platform):
    """Messaging-capable platforms have check_new_matches and send_message."""
    import importlib
    module_name, class_name, kwargs = PLATFORM_CLASSES[platform]
    mod = importlib.import_module(module_name)
    cls = getattr(mod, class_name)
    instance = cls(**kwargs)
    assert hasattr(instance, "check_new_matches"), f"{class_name} missing check_new_matches"
    assert hasattr(instance, "send_message"), f"{class_name} missing send_message"


# ---------------------------------------------------------------------------
# OKCupid login mock
# ---------------------------------------------------------------------------

class TestOKCupidLogin:
    def test_login_returns_bool_on_success(self):
        from clapcheeks.platforms.okcupid import OKCupidClient
        client = OKCupidClient()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "data": {
                "login": {
                    "oauth_token": "fake-token-123",
                    "user": {"userid": "12345", "username": "testuser"},
                }
            }
        }

        with patch("requests.post", return_value=mock_response):
            result = client.login("test@example.com", "password123")
            assert result is True
            assert client._token == "fake-token-123"

    def test_login_returns_false_on_failure(self):
        from clapcheeks.platforms.okcupid import OKCupidClient
        client = OKCupidClient()

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"data": {"login": {}}}

        with patch("requests.post", return_value=mock_response):
            result = client.login("bad@example.com", "wrong")
            assert result is False


# ---------------------------------------------------------------------------
# Happn can_swipe mock
# ---------------------------------------------------------------------------

class TestHappnCanSwipe:
    def test_login_returns_bool(self):
        from clapcheeks.platforms.happn import HappnClient
        client = HappnClient()

        # Mock both POST (OAuth) and GET (me endpoint)
        mock_post_resp = MagicMock()
        mock_post_resp.raise_for_status = MagicMock()
        mock_post_resp.json.return_value = {"access_token": "happn-token-abc"}

        mock_get_resp = MagicMock()
        mock_get_resp.raise_for_status = MagicMock()
        mock_get_resp.json.return_value = {"data": {"id": "99999"}}

        with patch("requests.post", return_value=mock_post_resp), \
             patch("requests.get", return_value=mock_get_resp):
            result = client.login("fb-token-xyz")
            assert isinstance(result, bool)
            assert result is True
            assert client._access_token == "happn-token-abc"

    def test_login_failure_returns_false(self):
        from clapcheeks.platforms.happn import HappnClient
        client = HappnClient()

        mock_post_resp = MagicMock()
        mock_post_resp.raise_for_status = MagicMock()
        mock_post_resp.json.return_value = {}  # no access_token

        with patch("requests.post", return_value=mock_post_resp):
            result = client.login("bad-token")
            assert result is False
