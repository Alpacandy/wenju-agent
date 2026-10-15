import React from 'react';
import SolidApp from './SolidSceneApp.jsx';
import register from './register.jsx';
register(({kind,spec})=><SolidApp kind={kind} initial={spec}/>);
