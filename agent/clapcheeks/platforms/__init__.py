"""Platform automation clients."""

try:
    from clapcheeks.platforms.tinder import TinderClient
except ImportError:
    pass

try:
    from clapcheeks.platforms.bumble import BumbleClient
except ImportError:
    pass

try:
    from clapcheeks.platforms.hinge import HingeClient
except ImportError:
    pass
