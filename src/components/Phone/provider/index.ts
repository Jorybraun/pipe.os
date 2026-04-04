/**
 * Phone provider barrel — registers all phone plugins as a side-effect import.
 *
 * Usage: import '../../components/Phone/provider';
 */

import { registerPhonePlugin } from '../../../lib/phone/pluginRegistry';
import { TwilioPlugin } from './TwilioProvider';

registerPhonePlugin(TwilioPlugin);
