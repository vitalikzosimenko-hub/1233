/** Platform entry: keep the 1.5 s bumper independent of game initialization. */
import { brandIntroFinished } from './brand-intro';

void brandIntroFinished.then(() => import('./main'));
