import {
  applyMiddleware,
  compose as reduxCompose,
  createStore as reduxCreateStore,
} from 'redux';
import reduxThunk from 'redux-thunk';
import * as helpers from './helpers';
import createStoreInternals from './create-store-internals';

export default function createStore(model, options = {}) {
  const {
    compose,
    devTools = true,
    disableImmer = false,
    enhancers = [],
    initialState = {},
    injections,
    middleware = [],
    mockActions = false,
    name: storeName = `EasyPeasyStore`,
    preMiddleware = [],
    reducerEnhancer = rootReducer => rootReducer,
  } = options;

  const bindReplaceState = modelDef => {
    return {
      ...modelDef,
      easyPeasyReplaceState: helpers.action((state, payload) => payload),
    };
  };

  let modelDefinition = bindReplaceState(model);
  let mockedActions = [];
  const references = {};

  const bindStoreInternals = (state = {}) => {
    references.internals = createStoreInternals({
      disableImmer,
      initialState: state,
      injections,
      model: modelDefinition,
      reducerEnhancer,
      references,
    });
  };

  bindStoreInternals(initialState);

  const listenerActionsMiddleware = () => next => action => {
    const result = next(action);
    if (
      action &&
      references.internals.listenerActionMap[action.type] &&
      references.internals.listenerActionMap[action.type].length > 0
    ) {
      const sourceAction = references.internals.actionCreatorDict[action.type];
      references.internals.listenerActionMap[action.type].forEach(
        actionCreator => {
          actionCreator({
            type: sourceAction ? sourceAction.type : action.type,
            payload: action.payload,
            error: action.error,
            result: action.result,
          });
        },
      );
    }
    return result;
  };

  const mockActionsMiddleware = () => () => action => {
    if (action != null) {
      mockedActions.push(action);
    }
    return undefined;
  };

  const computedPropertiesMiddleware = store => next => action => {
    references.internals.computedState.currentState = store.getState();
    references.internals.computedState.isInReducer = true;
    return next(action);
  };

  const easyPeasyMiddleware = [
    ...preMiddleware,
    computedPropertiesMiddleware,
    reduxThunk,
    ...middleware,
    listenerActionsMiddleware,
  ];

  if (mockActions) {
    easyPeasyMiddleware.push(mockActionsMiddleware);
  }

  const composeEnhancers =
    compose ||
    (devTools &&
    typeof window !== 'undefined' &&
    window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
      ? window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({
          name: storeName,
        })
      : reduxCompose);

  const store = reduxCreateStore(
    references.internals.reducer,
    references.internals.defaultState,
    composeEnhancers(applyMiddleware(...easyPeasyMiddleware), ...enhancers),
  );

  store.subscribe(() => {
    references.internals.computedState.isInReducer = false;
  });

  references.dispatch = store.dispatch;
  references.getState = store.getState;

  const bindActionCreators = () => {
    Object.keys(store.dispatch).forEach(actionsKey => {
      delete store.dispatch[actionsKey];
    });
    Object.keys(references.internals.actionCreators).forEach(key => {
      store.dispatch[key] = references.internals.actionCreators[key];
    });
  };

  bindActionCreators();

  const rebindStore = removeKey => {
    const currentState = store.getState();
    if (removeKey) {
      delete currentState[removeKey];
    }
    bindStoreInternals(store.getState());
    store.replaceReducer(references.internals.reducer);
    references.internals.actionCreatorDict['@action.easyPeasyReplaceState'](
      references.internals.defaultState,
    );
    bindActionCreators();
  };

  return Object.assign(store, {
    addModel: (key, modelForKey) => {
      if (modelDefinition[key] && process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn(
          `easy-peasy: The store model already contains a model definition for "${key}"`,
        );
        store.removeModel(key);
      }
      modelDefinition[key] = modelForKey;
      rebindStore();
    },
    clearMockedActions: () => {
      mockedActions = [];
    },
    getActions: () => references.internals.actionCreators,
    getListeners: () => references.internals.listenerActionCreators,
    getMockedActions: () => [...mockedActions],
    reconfigure: newModel => {
      modelDefinition = bindReplaceState(newModel);
      rebindStore();
    },
    removeModel: key => {
      if (!modelDefinition[key]) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn(
            `easy-peasy: The store model does not contain a model definition for "${key}"`,
          );
        }
        return;
      }
      delete modelDefinition[key];
      rebindStore(key);
    },
  });
}
