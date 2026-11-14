import { chooseUnknownFallback } from './agents/allergen';
import { parseCheckIn } from './agents/history';
import { extractIntake } from './agents/intake';
import { planMenu } from './agents/menu';
import { interpretEdit } from './agents/order';
import { pickProducts } from './agents/product';

/**
 * Every LLM judgment the delegate tools make, one function per specialist call.
 * Injected so tests can stub the model.
 */
export interface Specialists {
  extractIntake: typeof extractIntake;
  planMenu: typeof planMenu;
  pickProducts: typeof pickProducts;
  chooseUnknownFallback: typeof chooseUnknownFallback;
  interpretEdit: typeof interpretEdit;
  parseCheckIn: typeof parseCheckIn;
}

export const defaultSpecialists: Specialists = {
  extractIntake, planMenu, pickProducts, chooseUnknownFallback, interpretEdit, parseCheckIn,
};
