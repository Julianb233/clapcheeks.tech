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

try:
    from clapcheeks.platforms.grindr import GrindrClient
except ImportError:
    pass

try:
    from clapcheeks.platforms.badoo import BadooClient
except ImportError:
    pass

try:
    from clapcheeks.platforms.happn import HappnClient
except ImportError:
    pass

try:
    from clapcheeks.platforms.okcupid import OKCupidClient
except ImportError:
    pass

try:
    from clapcheeks.platforms.pof import POFClient
except ImportError:
    pass

try:
    from clapcheeks.platforms.feeld import FeeldClient
except ImportError:
    pass

try:
    from clapcheeks.platforms.coffeemeetsbagel import CMBClient
except ImportError:
    pass
